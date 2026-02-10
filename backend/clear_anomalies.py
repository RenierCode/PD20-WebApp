"""
# clear_anomalies.py - Reset Anomaly Tags
# See DOCS.md in project root for full documentation """
import pymongo
import os
from dotenv import load_dotenv

# Load database connection string from .env file
load_dotenv()
MONGO_URI = os.getenv("DATABASE_URL")

# Connect to MongoDB Atlas
client = pymongo.MongoClient(MONGO_URI)
db = client["sensorDB"]
collection = db["sensorReadings"]

# Remove anomaly fields from ALL documents in the collection
# $unset removes the specified fields entirely (not just sets them to null)
result = collection.update_many(
    {},  # Empty filter = match all documents
    {"$unset": {
        "anomaly": "",              # Remove binary anomaly flag
        "anomalies": "",            # Remove list of anomalous sensors
        "anomaly_processed_at": ""  # Remove processing timestamp
    }}
)

print(f"Cleared anomaly tags from {result.modified_count} documents")
client.close()
