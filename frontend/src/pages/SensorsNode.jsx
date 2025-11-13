import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LuHardDrive, LuTimer } from 'react-icons/lu';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

// StatusDisplay component (used by NodeCard)
const StatusDisplay = ({ status }) => {
  const colorClass = status === 'Active' ? 'text-[var(--status-active)]' : 'text-[var(--status-inactive)]';
  const bgClass = status === 'Active' ? 'bg-[var(--status-active)]' : 'bg-[var(--status-inactive)]';

  return (
    <div className={`flex items-center gap-2 font-medium ${colorClass}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${bgClass}`}></span>
      {status}
    </div>
  );
};

// --- NEW: NodeCard component (moved from Dashboard) ---
// This card now uses the StatusDisplay component
const NodeCard = ({ node }) => {
  return (
    <div
      className="bg-white rounded-lg shadow-md p-6 
                 transition-all transform hover:-translate-y-1 hover:shadow-lg"
    >
      {/* Card Header: Node ID and Status */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <LuHardDrive /> {node.nodeId}
        </h3>
        {/* MODIFIED: Use StatusDisplay instead of just a dot */}
        <StatusDisplay status={node.status} />
      </div>

      {/* Card Body: Sensor tags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {node.sensors.map((sensor) => (
          <span
            key={sensor}
            className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium"
          >
            {sensor}
          </span>
        ))}
      </div>

      {/* Card Footer: Last Seen time */}
      <div className="text-sm text-gray-500 flex items-center gap-2">
        <LuTimer />
        Last seen:{' '}
        {node.lastSeen ? new Date(node.lastSeen).toLocaleString() : 'Never'}
      </div>
    </div>
  );
};


// --- MODIFIED: SensorsNode component ---
const SensorsNode = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true); // For initial load only
  const [error, setError] = useState(null);

  // Memoized function to fetch nodes
  const fetchNodes = useCallback(async () => { 
    try { 
      const response = await axios.get(`${API_URL}/api/nodes`); 
      setNodes(response.data); 
      setError(null); // Clear error on successful fetch
    } catch(e){ 
      setError("Failed to fetch nodes."); 
      console.error("Poll:", e); 
    } 
  }, []);

  // Effect for initial node load
  useEffect(() => { 
    setLoading(true); 
    fetchNodes().finally(() => setLoading(false)); 
  }, [fetchNodes]);

  // --- NEW: Polling useEffect ---
  // Added to keep this page dynamic, just like the dashboard
  useEffect(() => { 
    const pollInterval = 10000; // Poll every 10 seconds
    console.log(`Setting up polling for Nodes page: ${pollInterval / 1000}s`);
    
    const id = setInterval(() => { 
      console.log("Polling nodes...");
      fetchNodes(); 
    }, pollInterval); 
    
    return () => {
      console.log("Clearing node polling interval.");
      clearInterval(id);
    };
  }, [fetchNodes]);

  if (loading) return <div>Loading node data...</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Nodes</h1>
      
      {/* Show polling error discreetly */}
      {error && !loading && <div className="mb-4 text-red-600 text-sm font-semibold">{error} Check console.</div>}

      {/* --- MODIFIED: Replaced Table with Node Card Grid --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {nodes.map(node => (
          // Each card is a Link that navigates to the NodeDetailPage
          <Link to={`/node/${node.nodeId}`} key={node.nodeId}>
            <NodeCard node={node} />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default SensorsNode;