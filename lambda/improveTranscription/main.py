import json
import boto3

bedrock_client = boto3.client(service_name='bedrock-runtime', region_name ='us-west-2')

def refine_transcript(text):
    prompt = '''This is the result of a transcription. I want you to look at this audio segment and fix the typos and mistakes present. Feel free to use the context of the rest of the transcript to refine (but don't leave out any info). Leave out parts where the speaker misspoke
    Make sure to also remove works like "uh" or "um". Only make change to the info or sentence structure when there are mistakes
    Only give back the refined transcript as output, don't add anything else or any context or title.
    If there are no typos or mistakes, return the original object input. Do not explain why you have or have not made any changes, I just want the JSON object.
    
    These are examples:
    Input: "Hello, everyone and welcome to this webinar around keeping your AWS environment safe from ransom vertex. I'm Laura Verghote. I'm a solution architect for public sector customers, mainly in the Benedicts. And with me, I have hy uh good afternoon everyone. Uh My name is Hiro, I'm a specialist solution architect for security. Um My team covers uh public sector customers in em and we help them on their cloud journey uh and to make it as secure as possible for them. Awesome. Thank you."
    Output: "Hello, everyone and welcome to this webinar around keeping your AWS environment safe from ransomware. I'm Laura Verghote. I'm a solution architect for public sector customers, mainly in the Benelux. And with me, I have Hiro. Hello, good afternoon everyone, my name is Hiro, I'm a specialist solution architect for security. My team covers public sector customers, and we help them on their cloud journey to make it as secure as possible for them. Awesome. Thank you."

    Input: ""
    Output: ""

    Input: "They'll tell you, they'll tell you, so I have to do that. All right, cool. Talk to me afterwards if you have questions. All right, so what are we going to learn today? Hopefully a lot, but not everything. Uh, we're going to start with three ways that we think about generative AI security. How do we break this down? You'll see a theme coming out of this. 2 is how to leverage the generative AI security scoping matrix. Just cur again, another curiosity, how many people have seen. The generative AI security scoping matrix. OK, good. How many of you actually used it in customer conversations or even internally? OK, that's awesome. I love feedback from that. Like, where does that resonate with what you needed to use it for? Where are the gaps? like find me after this or ping me on Slack. I'd really, that is a living breathing thing. It's not static, so if we can update it to make it even better, let me know. All right, and considerations for securing different types of generative AI workloads, um, this is kind of what we're going to cover today."
    Output:"They'll tell you, so I have to do that. All right, cool. Talk to me afterwards if you have questions. All right, so what are we going to learn today? Hopefully a lot, but not everything. We're going to start with three ways that we think about generative AI security. How do we break this down? You'll see a theme coming out of this. 2 is how to leverage the generative AI security scoping matrix. Just out of curiosity, how many people have seen 'the generative AI security scoping matrix'? OK, good. How many of you actually used it in customer conversations or even internally? OK, that's awesome. I'd love feedback from that. Like, where does that resonate with what you needed to use it for? Where are the gaps? Find me after this or ping me on Slack. It is a living breathing thing. It's not static, so if we can update it to make it even better, let me know. All right, and considerations for securing different types of generative AI workloads. This is kind of what we're going to cover today."


    Here is the object:
    ''' + text

    payload = {
        "modelId": "anthropic.claude-3-haiku-20240307-v1:0",
        "contentType": "application/json",
        "accept": "application/json",
        "body": json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1000,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
        })
    }
    
    response = bedrock_client.invoke_model(**payload)
    
    response_body = json.loads(response['body'].read())
    
    return response_body["content"][0]
    
def lambda_handler(event, context):

    try:
        # Retrieve the original transcript from the event
        transcript = event["Payload"]["transcript"]
        print("Original Transcript:", transcript)
        
        # Process the transcript to refine it
        refined_transcript = refine_transcript(transcript)
        print("Refined Transcript:", refined_transcript.get("text"))

        # Replace the transcript in the event with the refined transcript
        event["transcript"] = refined_transcript.get("text")
    except Exception as e:
        print("Error:", e)
        # If there's an error, return the original event
        return event

    # Return the modified event
    return event
