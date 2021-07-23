/*! Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: MIT-0
 */

/*
TODO: Firugre out how to publish axios layer publicly so that
the GB AWS account can download it
TODO: SAM Template way of getting email and password from Secrets Manager
TODO: SAM Template way of attaching minimal policy to the S3 bucket
*/

const AWS = require('aws-sdk')
const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const chromium = require('chrome-aws-lambda')
const axios = require('axios')

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
This method downloads PDF files to the S3 bucket
specified by the env var.
*/
const downloadFiles = async (browser, page, event) => {
  
  console.log('Downloading files...');
  const cookies = await page.cookies();
  const serializedCookies = cookies.reduce((acc, cur) => (`${acc}${cur.name}=${cur.value}; `), '').trim();

  const newPage = await browser.newPage();
  const id = event['id'];
  const theURL = event['url'];
  const theName = event['name'];
  await newPage.goto(theURL);
  await _downloadUploadedFiles(newPage, id, theName, serializedCookies);
};

/*
@preconditions:
- The download buttons are always blue.
- The file name is described under p tag before each button,
This private method parses the necessary info and all downloadable files
that were uploaded by the applicant whose applicant number is `num`.
*/
const _downloadUploadedFiles = async (page, num, name, cookies) => {
  // await mkdir(`/tmp/${num} ${name}`)
  
  // List of all items on the page (most of them are irrelevant)
  const definitionLists = await page.$$('table.input-table tbody dl');
  // List of pairs of title and href
  const targets = [];
  for (let i = 0; i < definitionLists.length; i++) {
    const dl = definitionLists[i];
    const downloadButton = await dl.$('a.btn._blue');
    if (downloadButton) {
      console.log("Found the download button!")
      const href = await downloadButton.evaluate(element => element.getAttribute('href'));
      // Make sure the file name exists 
      // TODO: Maybe we should put a placeholder filename and download every downloadable file?
      const existsFileName = await definitionLists[i - 1].$('p.upload_name');
      if (existsFileName) {
        // The file name must always be one element behind (i - 1) the download link!
        const originalFileName = await existsFileName.evaluate(element => element.textContent);
        const extension = originalFileName.split('.').pop().trim();
        // The jth element is trying to fetch the `<span>` tag, which
        // contains the title (e.g., 小論文１アップロード)
        let j = i - 2;
        let title = '';
        while (j > -1) {
          const span = await definitionLists[j].$('dd span');
          if (span) {
            title = await span.evaluate(span => span.textContent);
            title = title.trim();
            title = `${title}.${extension}`;
            break;
          }
          j = j - 1;
        }
        const downloadURL = `${pageURL}${href}`
        targets.push({ downloadURL, title });
      }
    }
  }
  
  await Promise.all(targets.map(({ downloadURL, title }) => (
    axios.get(downloadURL, {
      headers: {
        Cookie: cookies
      },
      responseType: 'arraybuffer'
    }).then(({ data }) => {
      console.log(data)
      return s3.upload({
        Bucket: process.env.S3_BUCKET,
        Key: `${num} ${name}/${name} ${title}`,
        Body: data,
        ContentType: 'application/pdf'
      }).promise()
    }).then(() => {
      console.log(`${name} ${title} successfully uploaded`)
    }).catch(err => {
      console.error(err)
    })
  )));
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
  await downloadFiles(browser, page, event)
  
  await page.close()
  await browser.close()
  
  return {
    "body": "Hello!!",
    "statusCode": "200"
  }
}