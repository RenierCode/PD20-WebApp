import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://127.0.0.1:8000';

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

const SensorsNode = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/nodes`);
        setNodes(response.data);
        setError(null);
      } catch (err) {
        setError("Failed to fetch nodes.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchNodes();
  }, []);

  if (loading) return <div>Loading node data...</div>;
  if (error) return <div className="text-red-600 font-semibold">{error}</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Nodes</h1>
      
      <div className="w-full bg-white rounded-lg shadow-md overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Node ID</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sensors</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {nodes.map(node => (
              <tr key={node.nodeId} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{node.nodeId}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <StatusDisplay status={node.status} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{node.sensors.join(', ')}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {/* <-- ADD THIS TERNARY OPERATOR --> */}
                  {node.location ? `${node.location.latitude.toFixed(4)}, ${node.location.longitude.toFixed(4)}` : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{node.lastSeen ? new Date(node.lastSeen).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SensorsNode;