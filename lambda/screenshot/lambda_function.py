import os
import boto3
import ffmpeg
import glob

s3_client = boto3.client('s3')

# Clean up /tmp directory
def cleanup_tmp_directory():
    files = glob.glob('/tmp/*')
    for file_path in files:
        try:
            os.remove(file_path)
            print(f"Deleted: {file_path}")
        except Exception as e:
            print(f"Failed to delete {file_path}: {e}")

def lambda_handler(event, context):
    # Ensure FFmpeg binary is available
    ffmpeg_binary = os.path.join(os.getcwd(), 'bin', 'ffmpeg')
    os.environ['PATH'] += f":{os.path.dirname(ffmpeg_binary)}"

    # Extract input details from the event
    input_bucket = os.environ["INPUT_BUCKET"]
    input_key = event["Payload"]["s3_key"]
    output_bucket = os.environ["OUTPUT_BUCKET"]
    output_key = f"screenshots_{input_key.split(".")[0]}/"

    # Define temporary paths
    video_path = '/tmp/input_video.mp4'

    # Download the video from S3
    s3_client.download_file(input_bucket, input_key, video_path)

    for segment in event["Payload"]["segments"]:

        try: 
            timestamp = segment["end_time"][:-3]

            print("timestamp:", timestamp)
            print("segment:", segment)

            screenshot_path = f'/tmp/{timestamp}.jpg'

            ffmpeg.input(video_path, ss=timestamp).output(screenshot_path, vframes=1).run()

            # Upload the screenshot back to S3
            s3_client.upload_file(screenshot_path, output_bucket, f"{output_key}{timestamp}.jpg")

        except Exception as e:
            print("Error:", e)

    cleanup_tmp_directory()

    return {
        "statusCode": 200,
        "outputbucket": output_bucket,
        "outputkey": output_key,
        "message": "Screenshots successfully created and uploaded"
    }

