import * as path from 'path';
import * as fs from 'fs';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { routes as clientsRoutes } from '../services/clients/handler';
import { routes as onboardingRoutes } from '../services/onboarding/handler';
import { routes as checksRoutes } from '../services/checks/handler';
import { routes as transactionsRoutes } from '../services/transactions/handler';
import { routes as identityRoutes } from '../services/identity/handler';
import { routes as filesRoutes } from '../services/files/handler';
import { EVENT_SOURCE } from '../services/shared/events';

export interface StarlixStackProps extends StackProps {
  stage: string;
  /** Keep data when the stack is deleted. Off for the demo so destroy.sh leaves nothing behind. */
  retainData?: boolean;
}

type Gsi = 'GSI1' | 'GSI2' | 'GSI3';

export class StarlixStack extends Stack {
  constructor(scope: Construct, id: string, props: StarlixStackProps) {
    super(scope, id, props);
    const removalPolicy = props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const root = path.join(__dirname, '..');

    // ---------- Auth ----------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `starlix-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        tenant: new cognito.StringAttribute({ mutable: true }),
        clientId: new cognito.StringAttribute({ mutable: true }),
        accountId: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Your Starlix login',
        emailBody: 'You have been invited to Starlix. Sign in with {username} and the temporary password {####}',
      },
      removalPolicy,
    });
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', { userPoolId: userPool.userPoolId, groupName: 'ADMIN' });
    new cognito.CfnUserPoolGroup(this, 'UserGroup', { userPoolId: userPool.userPoolId, groupName: 'USER' });
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true, userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
    });

    // ---------- Data ----------
    const table = (name: string, gsis: Gsi[]) => {
      const t = new dynamodb.Table(this, `${name}Table`, {
        tableName: `starlix-${props.stage}-${name.toLowerCase()}`,
        partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy,
      });
      for (const g of gsis) {
        t.addGlobalSecondaryIndex({
          indexName: g,
          partitionKey: { name: `${g}PK`, type: dynamodb.AttributeType.STRING },
          sortKey: { name: `${g}SK`, type: dynamodb.AttributeType.STRING },
        });
      }
      return t;
    };
    const tables = {
      identity: table('Identity', ['GSI1', 'GSI2']),
      clients: table('Clients', ['GSI1', 'GSI2']),
      onboarding: table('Onboarding', ['GSI1', 'GSI2', 'GSI3']),
      checks: table('Checks', []),
      transactions: table('Transactions', ['GSI1', 'GSI2', 'GSI3']),
    };
    const tableEnv = {
      IDENTITY_TABLE: tables.identity.tableName,
      CLIENTS_TABLE: tables.clients.tableName,
      ONBOARDING_TABLE: tables.onboarding.tableName,
      CHECKS_TABLE: tables.checks.tableName,
      TRANSACTIONS_TABLE: tables.transactions.tableName,
    };

    const filesBucket = new s3.Bucket(this, 'FilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !props.retainData,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    const bus = new events.EventBus(this, 'Bus', { eventBusName: `starlix-${props.stage}` });

    // ---------- Services ----------
    const fn = (name: string, extraEnv: Record<string, string> = {}, timeout = Duration.seconds(29)) => {
      const f = new NodejsFunction(this, `${name}Fn`, {
        functionName: `starlix-${props.stage}-${name.toLowerCase()}`,
        entry: path.join(root, 'services', name.toLowerCase(), 'handler.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout,
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        environment: {
          ...tableEnv,
          EVENT_BUS_NAME: bus.eventBusName,
          DEFAULT_TENANT: 'default',
          NODE_OPTIONS: '--enable-source-maps',
          ...extraEnv,
        },
        // Unminified so the code reads normally in the Lambda console; source maps map stack traces back to the .ts files
        bundling: { minify: false, keepNames: true, sourceMap: true, target: 'node22' },
        depsLockFilePath: path.join(root, 'package-lock.json'),
        projectRoot: root,
      });
      bus.grantPutEventsTo(f);
      return f;
    };

    const identityFn = fn('Identity', { USER_POOL_ID: userPool.userPoolId });
    const clientsFn = fn('Clients');
    const onboardingFn = fn('Onboarding');
    const checksFn = fn('Checks', { STUB_DELAY_MS: '800' }, Duration.minutes(5));
    const transactionsFn = fn('Transactions', {}, Duration.seconds(60));
    const filesFn = fn('Files', { FILES_BUCKET: filesBucket.bucketName });
    const seedFn = fn('Seed', { USER_POOL_ID: userPool.userPoolId, FILES_BUCKET: filesBucket.bucketName }, Duration.minutes(5));

    // Each service owns its table; the clients table is shared read-only for lookups.
    tables.identity.grantReadWriteData(identityFn);
    tables.clients.grantReadWriteData(clientsFn);
    tables.onboarding.grantReadWriteData(onboardingFn);
    tables.checks.grantReadWriteData(checksFn);
    tables.transactions.grantReadWriteData(transactionsFn);
    for (const f of [identityFn, onboardingFn, checksFn, transactionsFn]) tables.clients.grantReadData(f);
    for (const t of Object.values(tables)) t.grantReadWriteData(seedFn);
    filesBucket.grantReadWrite(filesFn);
    filesBucket.grantPut(seedFn);
    const cognitoAdmin = new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:ListUsers',
      ],
      resources: [userPool.userPoolArn],
    });
    identityFn.addToRolePolicy(cognitoAdmin);
    seedFn.addToRolePolicy(cognitoAdmin);

    // ---------- Events ----------
    const on = (id: string, detailTypes: string[], ...fns: lambda.IFunction[]) =>
      new events.Rule(this, id, {
        eventBus: bus,
        eventPattern: { source: [EVENT_SOURCE], detailType: detailTypes },
        targets: fns.map((f) => new targets.LambdaFunction(f, { retryAttempts: 2 })),
      });
    on('SubmittedToChecks', ['OnboardingSubmitted'], checksFn);
    on('ChecksToOnboarding', ['ChecksCompleted', 'UserActivated'], onboardingFn);
    on('StatusToClientsAndTx', ['OnboardingStatusChanged'], clientsFn, transactionsFn);
    on('SettingsToTx', ['TxSettingsChanged'], transactionsFn);
    new events.Rule(this, 'DailyExpiryScan', {
      schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
      targets: [new targets.LambdaFunction(onboardingFn)],
    });

    // ---------- API ----------
    const api = new apigw.HttpApi(this, 'Api', {
      apiName: `starlix-${props.stage}`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        maxAge: Duration.hours(1),
      },
    });
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, { userPoolClients: [userPoolClient] });
    const service = (name: string, f: lambda.IFunction, routeKeys: string[]) => {
      const integration = new HttpLambdaIntegration(`${name}Integration`, f);
      for (const rk of routeKeys) {
        const [method, routePath] = rk.split(' ');
        api.addRoutes({ path: routePath, methods: [method as apigw.HttpMethod], integration, authorizer });
      }
    };
    service('Identity', identityFn, Object.keys(identityRoutes));
    service('Clients', clientsFn, Object.keys(clientsRoutes));
    service('Onboarding', onboardingFn, Object.keys(onboardingRoutes));
    service('Checks', checksFn, Object.keys(checksRoutes));
    service('Transactions', transactionsFn, Object.keys(transactionsRoutes));
    service('Files', filesFn, Object.keys(filesRoutes));

    // ---------- Web ----------
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      // Single-page app: unknown paths serve index.html
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });
    const webDist = path.join(root, 'web', 'dist');
    if (fs.existsSync(path.join(webDist, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'WebDeployment', {
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ['/*'],
        sources: [
          // config.json from a local dev run must not shadow the generated one
          s3deploy.Source.asset(webDist, { exclude: ['config.json'] }),
          s3deploy.Source.jsonData('config.json', {
            apiUrl: api.apiEndpoint,
            region: this.region,
            userPoolId: userPool.userPoolId,
            userPoolClientId: userPoolClient.userPoolClientId,
            stage: props.stage,
          }),
        ],
      });
    } else {
      console.warn('web/dist not found: run "npm run build" in web/ (deploy.sh does this) to publish the UI.');
    }

    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'SeedFunctionName', { value: seedFn.functionName });
    new CfnOutput(this, 'Region', { value: this.region });
  }
}
