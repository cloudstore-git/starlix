import { App } from 'aws-cdk-lib';
import { StarlixStack } from './starlix-stack';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env.STARLIX_STAGE ?? 'demo';

new StarlixStack(app, `Starlix-${stage}`, {
  stage,
  retainData: app.node.tryGetContext('retainData') === 'true',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
  },
  description: 'Starlix demo MVP: Cognito, API Gateway, Lambda microservices, DynamoDB, EventBridge, S3/CloudFront',
});
