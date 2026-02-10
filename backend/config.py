"""
# config.py - Shared Configuration
# See DOCS.md in project root for full documentation"""
from pathlib import Path

# ============================================================================
# MODEL CONFIGURATION
# ============================================================================

# Directory where trained Isolation Forest models are stored (.joblib files)
MODELS_DIR = Path(__file__).parent / "models"

# Maps sensor names to their corresponding trained model files.
# Includes aliases (e.g., "pH" and "pH_level" both map to the same model)
# to handle different naming conventions in the database.
SENSOR_MODEL_MAP = {
    # Temperature sensor (water temperature in Celsius)
    "temperature": "IF_temperature.joblib",
    
    # pH level sensor (acidity/alkalinity of water)
    "pH_level": "IF_pH_level.joblib",
    "pH": "IF_pH_level.joblib",  # Alias for compatibility
    
    # Turbidity sensor (water clarity in NTU)
    "turbidity": "IF_turbidity.joblib",
    
    # Flow rate sensor (water flow in liters/hour)
    "flow_rate": "IF_flow_rate.joblib",
    "flowRate": "IF_flow_rate.joblib",  # Alias for camelCase
    
    # Water level sensor (depth in meters)
    "water_level": "IF_water_level.joblib",
    "waterLevel": "IF_water_level.joblib",  # Alias for camelCase
}

# ============================================================================
# THRESHOLD CONFIGURATION (Fallback Detection)
# ============================================================================

# Defines acceptable ranges for each sensor type.
# Values outside these ranges are flagged as anomalies when:
#   1. ML models are not available
#   2. Threshold-based detection is explicitly requested
#
# These thresholds are based on typical water quality standards:
#   - flowRate: 50-300 L/hr is normal pump operation
#   - waterLevel: 0.2-5.0 m is normal tank level
#   - pH: 6.5-8.5 is safe for most aquatic life
#   - turbidity: 0-10 NTU is considered clear water
#   - temperature: 5-35°C is typical for water systems
THRESHOLDS = {
    "flowRate": {"min": 50.0, "max": 300.0},
    "flow_rate": {"min": 50.0, "max": 300.0},
    "waterLevel": {"min": 0.2, "max": 5.0},
    "water_level": {"min": 0.2, "max": 5.0},
    "pH": {"min": 6.5, "max": 8.5},
    "pH_level": {"min": 6.5, "max": 8.5},
    "turbidity": {"min": 0.0, "max": 10.0},
    "temperature": {"min": 5.0, "max": 35.0},
}
