## Requirements

* AWS CLI already configured with Administrator permission
* [NodeJS 12.x installed](https://nodejs.org/en/download/)

## Installation Instructions

1. [Create an AWS account](https://portal.aws.amazon.com/gp/aws/developer/registration/index.html) if you do not already have one and login.

2. [Install Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) and [install the AWS Serverless Application Model CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html) on your local machine.

3. Create a new directory and navigate to that directory in a terminal.

4. Clone this repo:
```
git clone https://github.com/ShutoAraki/gbfdx.git
```

5. Navigate to this `backend` directory in a terminal.

6. Deploy the application:
```
sam deploy --guided
```
