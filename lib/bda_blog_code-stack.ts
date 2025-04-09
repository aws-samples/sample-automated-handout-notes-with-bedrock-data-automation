import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag'

export class BdaBlogCodeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Suppressing IAM4 for Lambda functions use of service-role/AWSLambdaBasicExecutionRole',
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Suppress all AwsSolutions-IAM5 findings on Role. Have validated that this is correct defaults",
      },
    ])

    /*------------------------------------ S3 BUCKET -------------------------------------- */
    //Log bucket
    const logBucket = new s3.Bucket(this, 'LogBucket', {
      bucketName: `bda-log-bucket-${cdk.Stack.of(this).account}-${Date.now()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Choose your desired removal policy
      autoDeleteObjects: true, // To delete objects if the bucket is deleted
      enforceSSL: true
    });

    // Create input bucket with unique name
    const inputBucket = new s3.Bucket(this, 'InputBucket', {
      bucketName: `bda-blog-input-${cdk.Stack.of(this).account}-${Date.now()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
      versioned: true,
      eventBridgeEnabled: true,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
    });

    // Create output bucket with unique name
    const outputBucket = new s3.Bucket(this, 'OutputBucket', {
      bucketName: `bda-blog-output-${cdk.Stack.of(this).account}-${Date.now()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
      versioned: true,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
    });

    /*-------------------------------- LAMBDA FUNCTIONS -------------------------------------- */

     const matchTranscriptsLambda = new lambda.Function(this, 'MatchTranscriptionsAndShotsLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'main.lambda_handler',
      code: lambda.Code.fromAsset('lambda/matchSegments'),
      memorySize: 300,  
      timeout: cdk.Duration.minutes(5),
    });

    const improveTranscriptionLambda = new lambda.Function(this, 'ImproveTranscriptionLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'main.lambda_handler',
      code: lambda.Code.fromAsset('lambda/improveTranscription'),
      timeout: cdk.Duration.minutes(5)
    });

    const screenshotLambda = new lambda.Function(this, 'ScreenshotLambda', {
      runtime: lambda.Runtime.PYTHON_3_12, // Python 12 to be compatible with the Libraries (ffmpeg)
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('lambda/screenshot/lambda_function.zip'),
      memorySize: 1024,  
      timeout: cdk.Duration.minutes(5),
      environment: {
        INPUT_BUCKET: inputBucket.bucketName,
        OUTPUT_BUCKET: outputBucket.bucketName
      }
    });
    NagSuppressions.addResourceSuppressions(screenshotLambda, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Lambda 3.12 is required for this function.'
      },
    ])

    const handoutsLayer = new lambda.LayerVersion(this, 'HandoutsLayer', {
      code: lambda.Code.fromAsset('lambda/layers/pptx-layer.zip'), 
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13], 
      description: 'Layer for creating handouts', 
    });

    const createHandoutsLambda = new lambda.Function(this, 'CreateHandoutsLambda', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'main.lambda_handler',
      code: lambda.Code.fromAsset('lambda/createHandouts'),
      timeout: cdk.Duration.minutes(5),
      layers: [handoutsLayer],
    });


    /*----------------------------- PERMISSIONS FOR LAMBDA ROLES ------------------------------- */

    screenshotLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`${inputBucket.bucketArn}/*`],
    }));

    screenshotLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:PutObject"],
      resources: [`${outputBucket.bucketArn}/*`],
    }));

    matchTranscriptsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`${outputBucket.bucketArn}/*`],
    }));

    matchTranscriptsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:ListBucket"],
      resources: [`${outputBucket.bucketArn}`],
    }));

    improveTranscriptionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-west-2:*:*'],
    }));

    createHandoutsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [`${outputBucket.bucketArn}/*`],
    }));

    // Add S3 write permissions for handouts directory
    createHandoutsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${outputBucket.bucketArn}/*`],
    }));

    createHandoutsLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket'],
      resources: [`${outputBucket.bucketArn}`],
    }));

/*------------------------------------ BDA PROJECT -------------------------------------- */

  const bdaProject = new cdk.CfnResource(this, 'BDAProject', {
    type: 'AWS::Bedrock::DataAutomationProject',
    properties: {
        ProjectDescription : "This project has been created as part of the BDA blog post",
        "ProjectName" : "MyBDAProject",
        StandardOutputConfiguration : {
            Image: {
              Extraction: {
                BoundingBox : {
                  State: "ENABLED"
                },
                Category : {
                  State: "ENABLED",
                  Types: ["TEXT_DETECTION"]
                }
              },
            },
            Video: {
              Extraction: {
                BoundingBox : {
                  State: "ENABLED"
                },
                Category : {
                  State: "ENABLED",
                  Types: ["TRANSCRIPT"]
                }
              },
              GenerativeField:{
                State: "ENABLED",
                Types: ["VIDEO_SUMMARY"]
              }
            }, 
            Audio: {
              Extraction: {
                Category: {
                  State: "ENABLED",
                  Types: ["TRANSCRIPT"]
                }
              }
            }
            }
        },
    }
  );

/* ----------------------------- STEP FUNCTION ------------------------------- */

    // Define Step Functions tasks
    const invokeDataAutomation = new tasks.CallAwsService(this, 'InvokeDataAutomationAsync', {
      service: 'bedrockdataautomationruntime',
      action: 'invokeDataAutomationAsync',
      parameters: {
        "DataAutomationProfileArn": `arn:aws:bedrock:${this.region}:${this.account}:data-automation-profile/us.data-automation-v1`,
        'InputConfiguration': {
          'S3Uri.$': "States.Format('s3://{}/{}', $.detail.bucket.name, $.detail.object.key)"
        },
        'DataAutomationConfiguration': {
          'DataAutomationProjectArn': bdaProject.getAtt("ProjectArn").toString()
        },
        'OutputConfiguration': {
          'S3Uri': `s3://${outputBucket.bucketName}/`
        }
      },
      resultSelector: {
        "InvocationArn.$": "$.InvocationArn"
      },
      iamResources: ['*'],
    });

    const wait5Minutes = new sfn.Wait(this, 'Wait2Minutes', {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(2)),
    });

    // Initial status check
    const getDataAutomationStatus = new tasks.CallAwsService(this, 'GetDataAutomationStatus', {
      service: 'bedrockdataautomationruntime',
      action: 'getDataAutomationStatus',
      parameters: {
        'InvocationArn.$': '$.InvocationArn'
      },
      resultPath: '$.statusResult',
      iamResources: ['*'],
    });


    const matchSegments = new tasks.LambdaInvoke(this, 'MatchSegments', {
      lambdaFunction: matchTranscriptsLambda,
      outputPath: '$.Payload',
      payload: sfn.TaskInput.fromObject({
        'OutputS3Uri.$': '$.statusResult.OutputConfiguration.S3Uri',
        'InputData.$': '$'
      }),
      retryOnServiceExceptions: true,
    });

    const refinedTranscript = new tasks.LambdaInvoke(this, 'RefinedTranscript', {
      lambdaFunction: improveTranscriptionLambda,
      outputPath: '$.Payload',
      payload: sfn.TaskInput.fromObject({
        'Payload.$': '$'
      }),
      retryOnServiceExceptions: true,
    });

    const takeScreenshots = new tasks.LambdaInvoke(this, 'TakeScreenshots', {
      lambdaFunction: screenshotLambda,
      outputPath: '$.Payload',
      payload: sfn.TaskInput.fromObject({
        'Payload.$': '$'
      }),
      retryOnServiceExceptions: true,
    });

    const createHandouts = new tasks.LambdaInvoke(this, 'CreateHandouts', {
      lambdaFunction: createHandoutsLambda,
      outputPath: '$.Payload',
      payload: sfn.TaskInput.fromObject({
        'Payload.$': '$'
      }),
      retryOnServiceExceptions: true,
    });

    // Define Map state for transcript processing
    const processTranscripts = new sfn.Map(this, 'Go over each transcript', {
      itemsPath: '$.segments',
      maxConcurrency: 1,
    }).itemProcessor(refinedTranscript)

    // Define parallel state for screenshots and refinement
    const parallelTasks = new sfn.Parallel(this, 'Screenshots and refinement')
      .branch(processTranscripts)
      .branch(takeScreenshots);


    // Create the choice state without the loop first
    const choice = new sfn.Choice(this, 'ProcessingJobCompleted')
      .when(sfn.Condition.stringEquals('$.statusResult.Status', 'Success'), matchSegments.next(parallelTasks).next(createHandouts))
      .otherwise(wait5Minutes);

    // Create chain
    const definition = invokeDataAutomation
      .next(wait5Minutes)
      .next(getDataAutomationStatus)
      .next(choice);


    // Create role for Step Functions
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });

    //Add permissions for S3
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
      ],
      resources: [outputBucket.arnForObjects('*'),],
    }));

    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
      ],
      resources: [inputBucket.arnForObjects('*'),],
    }));

    // Add permissions for Bedrock Data Automation
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeDataAutomationAsync'
      ],
      resources: [
        bdaProject.getAtt("ProjectArn").toString(),
        `arn:aws:bedrock:us-east-1:${this.account}:data-automation-profile/us.data-automation-v1`,
        `arn:aws:bedrock:us-east-2:${this.account}:data-automation-profile/us.data-automation-v1`,
        `arn:aws:bedrock:us-west-1:${this.account}:data-automation-profile/us.data-automation-v1`,
        `arn:aws:bedrock:us-west-2:${this.account}:data-automation-profile/us.data-automation-v1`,
      ],
    }));

    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:GetDataAutomationStatus'
      ],
      resources: ['*'],
    }));

    // Add permissions to invoke Lambda functions
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        matchTranscriptsLambda.functionArn,
        improveTranscriptionLambda.functionArn,
        screenshotLambda.functionArn,
        createHandoutsLambda.functionArn,
      ],
    }));

    // Log group for Step Functions
    const logGroup = new logs.LogGroup(this, 'BDABlogStepFunctionsLogs');

    // Create state machine
    const stateMachine = new sfn.StateMachine(this, 'MyStateMachine', {
      definition,
      stateMachineType: sfn.StateMachineType.STANDARD,
      role: stepFunctionsRole,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
      },
      tracingEnabled: true
    });

    /*-------------------------------------EVENTBRIDGE RULE---------------------------------- */
    const rule = new events.Rule(this, 'S3EventRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [inputBucket.bucketName]
          }
        },
      },
    });

    // Set the EventBridge rule to trigger the state machine
    rule.addTarget(new targets.SfnStateMachine(stateMachine));

    // Outputs
    new cdk.CfnOutput(this, 'InputBucketName', {
      value: inputBucket.bucketName,
      description: 'The name of the input bucket'
    });


  } // Constructor closing brace
} // Class closing brace

    
