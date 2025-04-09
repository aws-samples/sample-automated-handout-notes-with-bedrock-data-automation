import boto3
import json
import re

s3 = boto3.client('s3')

def get_s3_file(bucket, key):
    """
    Retrieve a file from S3 and return its content.
    """
    try:
        print(f"Fetching from bucket: {bucket}, key: {key}")
        response = s3.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        print("Successfully retrieved file from S3")
        return content
    except Exception as e:
        print(f"Error in get_s3_file: {str(e)}")
        raise RuntimeError(f"Error fetching file from S3: {str(e)}")

    
def parse_s3_uri(s3_uri: str):
    """
    Extracts the bucket name and key from an S3 URI.
    
    :param s3_uri: str - The S3 URI (e.g., 's3://my-bucket/path/to/object.txt')
    :return: tuple - (bucket_name, key)
    """
    
    if not s3_uri.startswith("s3://"):
        raise ValueError("Invalid S3 URI. Must start with 's3://'")
    
    s3_uri = s3_uri[5:]  # Remove 's3://'
    parts = s3_uri.split('/', 1)
    bucket_name = parts[0]
    key = parts[1] if len(parts) > 1 else ""
    return bucket_name, key

def reconstruct_audio_segments(json_object):
    
    try:

        # Extract audio_segments from each scene
        audio_segments = [
            segment for scene in json_object.get("scenes", []) 
            for segment in scene.get("audio_segments", [])
        ]

        # Convert to JSON string
        filtered_data = json.dumps({"audio_segments": audio_segments}, indent=2)

        #if the audio_segment is empty then do the following:
        if not audio_segments:
            print("No audio segments found in scenes")
            audio_segments = [
                segment for chapter in json_object.get("chapters", []) 
                for segment in chapter.get("audio_segments", [])
        ]

        filtered_data = json.dumps({"audio_segments": audio_segments}, indent=2)
        print(f"Filtered JSON successfully created")
        return filtered_data

    except Exception as e:
        print("Error processing JSON:", e)

def get_shots(json_object):
    
    try:

        # Extract shots
        shots = json_object.get("shots", []) 

        # Convert to JSON string
        filtered_shots = json.dumps({"shots": shots}, indent=2)

        print(f"Filtered JSON successfully created")

        return filtered_shots

    except Exception as e:
        print("Error processing JSON:", e)


def match_segments_with_transcripts(segments, transcripts):
    """
    Match transcript entries to the corresponding segments based on timing.    ensuring each transcript is matched to only one segment. Excludes segments with empty transcripts.
    """
    matched_data = []
    used_transcripts = set()  # Keep track of used transcript indices

    # Sort segments by start time to ensure consistent matching
    segments = sorted(segments, key=lambda x: x['start_timestamp_millis'])

    for segment in segments:
        segment_start_ms = segment['start_timestamp_millis']
        segment_end_ms = segment['end_timestamp_millis']
        segment_start_timecode = segment['start_timecode_smpte']
        segment_end_timecode = segment['end_timecode_smpte']
        matched_transcripts = []

        # Calculate the duration of the segment
        segment_duration_ms = segment_end_ms - segment_start_ms

        # Skip segments shorter than 1 second
        if segment_duration_ms < 1000:
            print(f"Skipping segment with duration {segment_duration_ms}ms: {segment_start_timecode} - {segment_end_timecode}")
            continue

        # Find the transcript that best matches this segment
        for i, transcript in enumerate(transcripts):
            if i in used_transcripts:
                continue  # Skip already used transcripts

            transcript_start_ms = transcript['start_timestamp_millis']
            transcript_end_ms = transcript['end_timestamp_millis']

            # Check if there is an overlap
            if (transcript_start_ms <= segment_end_ms and transcript_end_ms >= segment_start_ms):
                # Calculate overlap percentage
                overlap_start = max(transcript_start_ms, segment_start_ms)
                overlap_end = min(transcript_end_ms, segment_end_ms)
                overlap_duration = overlap_end - overlap_start
                
                # If overlap is significant (e.g., more than 50% of the transcript duration)
                if overlap_duration > (transcript_end_ms - transcript_start_ms) * 0.5:
                    matched_transcripts.append(transcript['text'])
                    used_transcripts.add(i)

        # Combine all matched transcripts into a single string
        merged_transcripts = " ".join(matched_transcripts)

        # Only append segments that have non-empty transcripts
        if merged_transcripts.strip():  # This checks if the transcript is non-empty after trimming whitespace
            matched_data.append({
                "start_time": segment_start_timecode,
                "end_time": segment_end_timecode,
                "transcript": merged_transcripts
            })
    
    return matched_data


    

def lambda_handler(event, context):
    print("Received event:", event)
    try:
        results_uri = event["InputData"]["statusResult"]["OutputConfiguration"]["S3Uri"]
        print("Results URI:", results_uri)
        
        metadata_bucket, metadata_key = parse_s3_uri(results_uri)
        print(f"Metadata bucket: {metadata_bucket}, key: {metadata_key}")
        
        metadata = get_s3_file(metadata_bucket, f"/{metadata_key}")
        print("Retrieved metadata:", metadata)
        
        meta_json = json.loads(metadata)
        print("Parsed metadata JSON:", meta_json)
        
        uri = meta_json["output_metadata"][0]["segment_metadata"][0]["standard_output_path"]
        print("Source URI:", uri)
        
        source_bucket, source_key = parse_s3_uri(uri)
        data = get_s3_file(source_bucket, source_key)
        json_object = json.loads(data)

        audio_segments = json.loads(reconstruct_audio_segments(json_object))['audio_segments']
        print("Audio segments:", audio_segments)
        shots = json.loads(get_shots(json_object))['shots']
        print("shots:", shots)
        metadata_json = json_object.get("metadata", {})
        s3_key = metadata_json.get("s3_key", "")
        
        matched_segments = match_segments_with_transcripts(shots, audio_segments)
        print("Matched segments:", matched_segments)
        matched_segments = match_segments_with_transcripts(shots, audio_segments)
        print("Matched segments:", matched_segments)
        
        # Return the data directly
        return {
            'segments': matched_segments,
            's3_key': s3_key
        }

    except Exception as e:
        print(f"Error processing JSON: {str(e)}")
        return {
            'segments': [],
            's3_key': '',
            'error': str(e)
        }