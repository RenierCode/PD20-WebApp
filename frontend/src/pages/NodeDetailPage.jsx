import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import SensorGraph from '../components/SensorGraph'; 
import { LuChevronLeft } from 'react-icons/lu';

const API_URL = 'http://127.0.0.1:8000';

const NodeDetailPage = () => {
  const { nodeId } = useParams();
  
  const [initialData, setInitialData] = useState([]); 
  const [sensorKeys, setSensorKeys] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // State to control anomaly detection for all graphs
  const [showAnomalies, setShowAnomalies] = useState(false);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        // Fetch 'latest24h' data (default range)
        const response = await axios.get(
          `${API_URL}/api/nodes/${nodeId}/readings?range=latest24h` 
        );
        
        const data = response.data;
        if (data.length > 0) {
          setSensorKeys(Object.keys(data[0].sensorData));
          setInitialData(data);
        } else {
          setError("No data found for this node.");
        }
        
      } catch (err) {
        setError("Failed to fetch sensor readings.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (nodeId) fetchInitialData();
  }, [nodeId]); // Only depends on nodeId
  
  // Handler for the button
  const toggleAnomalies = () => {
    setShowAnomalies(prev => !prev);
  };

  return (
    <div>
      <Link 
        to="/" 
        className="flex items-center gap-1 text-blue-500 hover:underline mb-4 text-lg"
      >
        <LuChevronLeft /> Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-4xl font-bold">Sensor Data for {nodeId}</h1>
         
         {/* Button now toggles state */}
         <button 
          className={`px-4 py-2 rounded-md font-semibold transition-colors
                     ${showAnomalies 
                       ? 'bg-red-500 hover:bg-red-600 text-white' 
                       : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
          onClick={toggleAnomalies}
        >
          {showAnomalies ? 'Hide Anomalies' : 'Detect Anomalies'}
        </button>
      </div>

      {/* Grid for the graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading && <p>Loading data...</p>}
        {error && <p className="text-red-500">{error}</p>}
        
        {!loading && !error && sensorKeys.length > 0 ? (
          sensorKeys.map((key, index) => {
            const isLastAndOdd = (index === sensorKeys.length - 1) && (sensorKeys.length % 2 !== 0);
            const itemClassName = isLastAndOdd ? 'lg:col-span-2' : '';

            return (
              <SensorGraph 
                key={key}
                nodeId={nodeId}
                sensorKey={key}
                initialData={initialData}
                className={itemClassName}
                // Pass the toggle state down
                showAnomalies={showAnomalies}
              />
            );
          })
        ) : (
          !loading && <p>No sensor data available for this node.</p>
        )}
      </div>
    </div>
  );
};

export default NodeDetailPage;