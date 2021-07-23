/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */

/*
TODO: Firugre out how to publish axios layer publicly so that
the GB AWS account can download it
TODO: SAM Template way of getting email and password from Secrets Manager
TODO: SAM Template way of attaching minimal policy to the S3 bucket
*/
const AWS = require('aws-sdk');
const chromium = require('chrome-aws-lambda');
var lambda = new AWS.Lambda();

const pageURL = process.env.TARGET_URL
const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36'

const email = process.env.EMAIL
const password = process.env.PASSWORD

const defaultOptions = {
  year: (new Date().getFullYear() + 1).toString()
}

const _selectElement = async (parents, selector) => {
  const element = await parents.$(selector)
  if (!element) throw new Error(`Element "${selector}" not found`)
  return element
}

/*
This method starts headless chromium and then
passes admin email and password info (specified by the env vars)
into syutsugan.net to login
*/
const login = async () => {
  let browser = null;
  let successFlag = false;

  browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  let page = await browser.newPage();
  await page.setUserAgent(agent)

  console.log('Navigating to page: ', pageURL)

  await page.goto(`${pageURL}/admins/sign_in`)
  
  while (!successFlag) {
    await _selectElement(page, 'input[type=email]').then(element => element.type(email));
    await _selectElement(page, 'input[type=password]').then(element => element.type(password));
    await Promise.all([
      _selectElement(page, 'input[type=submit]').then(element => element.click()),
      page.waitForNavigation()
    ]);
    if (page.url().includes('/home')) {
      console.log('Login successful\n');
      successFlag = true;
    } else {
      console.log('Login failed\n');
    }
  }

  return { browser, page }
}

/*
This method selects the current year to get
the list of applicants for this year.
*/
const setFilter = async (page, options) => {
  console.log(`Setting filter conditions with year = ${options.year}...\n`);
  await page.goto(`${pageURL}/applicants`);
  if (options.year) {
    const { year } = options;
    await _selectElement(page, 'select#selFiscalYear').then(element => element.select(year));
  }
  await Promise.all([
    _selectElement(page, 'input#btnSubmitSearch').then(element => element.click()),
    page.waitForNavigation()
  ]);
}

/*
Fetch the URLs for each candidate
*/
const getBody = async (page) => {
  console.log("Fetching URLs") 
  var body = [];
  // Go through each applicant and click on their name
  const tableRows = await page.$$('#lstApplicants tbody tr')
  for (const tr of tableRows) {
    var element = await _selectElement(tr, 'div.user-info a');
    var href = await element.evaluate(element => element.getAttribute('href'));
    var theName = await element.evaluate(element => element.textContent);
    var [applicantNum] = href.split('/').slice(-1);
    const theURL = `${pageURL}${href}`;
    body.push({
      id: applicantNum,
      name: theName,
      url: theURL
    });
  }
  return body;
};

/*
This handler requires an event JSON object of type 
{
  applicantNum: string
}
`applicantNum` is the UID that can be obtained from the URL
for each applicant
*/
exports.handler = async (event, context) => {
  const { browser, page } = await login()
  await setFilter(page, defaultOptions)
  const body = await getBody(page)
  const uploadFunction = process.env.CHILD_LAMBDA
  
  body.map(request => {
    var params = {
      FunctionName: uploadFunction,
      InvocationType: 'Event',
      LogType: 'Tail',
      Payload: JSON.stringify(request)
    };
  
    lambda.invoke(params, function(err, data) {
      if (err) {
        context.fail(err);
      } else {
        context.succeed(`Successfully invoked ${uploadFunction}`);
      }
    });
  });
  
  await page.close()
  await browser.close()
  
  return {
    "body": body,
    "statusCode": "200"
  }
}