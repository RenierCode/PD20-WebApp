import React, { useState, useEffect, useMemo, useCallback } from 'react'; // Import useCallback and useMemo
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import SensorGraph from '../components/SensorGraph'; 
import { LuChevronLeft, LuSignal } from 'react-icons/lu'; // Added LuSignal

const API_URL = 'http://127.0.0.1:8000';

// --- Card component for latest sensor data (from previous step) ---
const NodeLatestDataCard = ({ sensorKey, value, timestamp }) => {
  const formatTime = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="bg-white p-4 rounded-lg shadow-md">
      <div className="flex justify-between items-baseline mb-1">
        <div className="text-lg font-semibold text-gray-800 capitalize">{sensorKey}</div>
        <div className="font-mono text-xs text-gray-500">{formatTime(timestamp)}</div>
      </div>
      <div className="text-3xl font-bold text-blue-600 truncate" title={String(value)}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
    </div>
  );
};


const NodeDetailPage = () => {
  const { nodeId } = useParams();
  
  const [initialData, setInitialData] = useState([]); 
  const [sensorKeys, setSensorKeys] = useState([]); 
  const [loading, setLoading] = useState(true); // For initial page load
  const [error, setError] = useState(null);
  
  // State to control anomaly detection for all graphs
  const [showAnomalies, setShowAnomalies] = useState(false);

  // --- MODIFIED: fetchInitialData is wrapped in useCallback ---
  // We add 'isPoll' to avoid resetting the main loading spinner
  const fetchInitialData = useCallback(async (isPoll = false) => {
    if (!isPoll) setLoading(true); // Only show full "Loading..." on first load
    setError(null);
    try {
      // Fetch 'latest24h' data (default range)
      const response = await axios.get(
        `${API_URL}/api/nodes/${nodeId}/readings?range=latest24h` 
      );
      
      const data = response.data;
      if (data.length > 0) {
        // Robustly find all sensor keys from all readings
        const allKeys = new Set();
        data.forEach(reading => {
          if (reading.sensorData) {
            Object.keys(reading.sensorData).forEach(key => allKeys.add(key));
          }
        });
        setSensorKeys(Array.from(allKeys).sort());
        setInitialData(data); // This state update triggers graphs to re-render
      } else {
        // Don't set error if polling and no data, just clear
        if (!isPoll) setError("No data found for this node.");
        setInitialData([]);
        setSensorKeys([]);
      }
      
    } catch (err) {
      setError("Failed to fetch sensor readings.");
      console.error(err);
    } finally {
      if (!isPoll) setLoading(false);
    }
  }, [nodeId]); // Depends only on nodeId

  // --- MODIFIED: This effect runs ONCE for initial load ---
  useEffect(() => {
    if (nodeId) fetchInitialData(false); // Call as a manual load
  }, [nodeId, fetchInitialData]); // Only depends on nodeId and the function
  
  // --- NEW: Polling useEffect ---
  useEffect(() => {
      const pollInterval = 5000; // Poll every 5 seconds
      console.log(`Setting up polling for ${nodeId}: ${pollInterval / 1000}s`);

      const intervalId = setInterval(() => {
          console.log(`Polling data for ${nodeId}...`);
          fetchInitialData(true); // Call as a background poll
      }, pollInterval);

      // Cleanup function to stop polling when leaving the page
      return () => {
          console.log(`Clearing polling for ${nodeId}.`);
          clearInterval(intervalId);
      };
  }, [fetchInitialData, nodeId]); // Restart poll if nodeId changes

  
  // --- Calculate latest data for each sensor (from previous step) ---
  const latestSensorData = useMemo(() => {
    if (initialData.length === 0 || sensorKeys.length === 0) {
      return [];
    }
    return sensorKeys.map(key => {
      const lastEntry = [...initialData].reverse().find(
        reading => reading.sensorData && reading.sensorData[key] != null
      );
      if (lastEntry) {
        return { sensorKey: key, value: lastEntry.sensorData[key], timestamp: new Date(lastEntry.timestamp) };
      }
      return null;
    }).filter(Boolean);
  }, [initialData, sensorKeys]);
  
  // Handler for the button (Unchanged)
  const toggleAnomalies = () => {
    setShowAnomalies(prev => !prev);
  };

  // Show initial loading screen
  if (loading) return <div>Loading data...</div>;

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
        {error && !loading && <div className="text-red-600 font-semibold">{error}</div>}
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

      {/* --- Latest Readings Section (Updates via polling) --- */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Latest Readings</h2>
        {latestSensorData.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {latestSensorData.map(data => (
              <NodeLatestDataCard
                key={data.sensorKey}
                sensorKey={data.sensorKey}
                value={data.value}
                timestamp={data.timestamp}
              />
            ))}
          </div>
        ) : (
           <p className="p-4 bg-white rounded-lg text-gray-500">No latest data found for this node.</p>
        )}
      </section>

      {/* --- Sensor History (Graphs) Section (Updates via polling) --- */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sensor History</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {!loading && !error && sensorKeys.length > 0 ? (
            sensorKeys.map((key, index) => {
              const isLastAndOdd = (index === sensorKeys.length - 1) && (sensorKeys.length % 2 !== 0);
              const itemClassName = isLastAndOdd ? 'lg:col-span-2' : '';

              return (
                <SensorGraph 
                  key={key}
                  nodeId={nodeId}
                  sensorKey={key}
                  initialData={initialData} // This prop now updates from polling
                  className={itemClassName}
                  showAnomalies={showAnomalies}
                />
              );
            })
          ) : (
            !loading && <p>No sensor data graphs to display.</p>
          )}
        </div>
      </section>
    </div>
  );
};

export default NodeDetailPage;