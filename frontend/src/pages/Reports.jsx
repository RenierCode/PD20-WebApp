import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import Papa from 'papaparse';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js';

// Register Chart.js components (needed for react-chartjs-2)
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
);

const API_URL = 'http://127.0.0.1:8000';

const Reports = () => {
  // State for the list of nodes
  const [nodes, setNodes] = useState([]);
  // State for the currently selected node
  const [selectedNode, setSelectedNode] = useState('');
  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // State to hold the data for the charts we'll generate
  const [chartConfigs, setChartConfigs] = useState([]);
  // Refs to access the <Line> component's chart instance
  const chartRefs = useRef([]);

  // 1. Fetch all nodes for the dropdown when the page loads
  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/nodes`);
        setNodes(response.data);
      } catch (err) {
        console.error("Failed to fetch nodes", err);
      }
    };
    fetchNodes();
  }, []);

  // 2. Helper function to fetch data for the selected node
  const fetchNodeData = async (nodeId) => {
    if (!nodeId) {
      setError('Please select a node first.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}/api/nodes/${nodeId}/readings`);
      return response.data;
    } catch (err) {
      setError('Failed to fetch data for this node.');
      return null;
    }
  };

  // 3. Handle CSV Generation
  const handleGenerateCSV = async () => {
    const data = await fetchNodeData(selectedNode);
    if (!data || data.length === 0) {
      setLoading(false);
      if (!error) setError("No data found for this node.");
      return;
    }

    // Flatten the data from { timestamp, sensorData: { temp, pH } }
    // to { timestamp, temp, pH }
    const flatData = data.map(reading => ({
      timestamp: new Date(reading.timestamp).toLocaleString(),
      ...reading.sensorData
    }));

    // Convert JSON to CSV string
    const csv = Papa.unparse(flatData);

    // Create a blob and trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${selectedNode}_data.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setLoading(false);
  };

  // 4. Handle PDF Generation (Step 1: Fetch and prepare data)
  const handleGeneratePDF = async () => {
    const data = await fetchNodeData(selectedNode);
    if (!data || data.length === 0) {
      setLoading(false);
      if (!error) setError("No data found for this node.");
      return;
    }

    // Process data into chart.js format
    const sensorKeys = Object.keys(data[0].sensorData);
    const labels = data.map(d => new Date(d.timestamp).toLocaleDateString()); // Use shorter date labels for PDF

    const configs = sensorKeys.map(key => ({
      sensorName: key,
      data: {
        labels,
        datasets: [{
          label: key,
          data: data.map(d => d.sensorData[key]),
          borderColor: `rgb(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)})`,
          tension: 0.1,
          pointRadius: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: true, text: `Sensor: ${key.toUpperCase()}` },
        },
        animation: {
          duration: 0 // Disable animation for faster image capture
        }
      },
    }));

    // Reset refs array
    chartRefs.current = new Array(configs.length);
    // Set the configs, which will render the hidden charts
    setChartConfigs(configs);
    // The useEffect hook below will handle the rest
  };

  // 5. Handle PDF Generation (Step 2: Create PDF after charts are rendered)
  useEffect(() => {
    // This effect runs when `chartConfigs` changes and we are in `loading` state
    if (chartConfigs.length === 0 || !loading) return;

    // Wait a brief moment for React to render the hidden charts
    const timer = setTimeout(() => {
      try {
        const doc = new jsPDF();
        doc.text(`Sensor Report for ${selectedNode}`, 14, 15);
        let yPos = 25;

        chartRefs.current.forEach((chartInstance, index) => {
          if (chartInstance) {
            // Get the chart's canvas as a Base64 image
            const imgData = chartInstance.toBase64Image();
            
            // Add a new page if the chart won't fit
            if (yPos + 100 > 280) { // 280 is close to bottom of A4 page
              doc.addPage();
              yPos = 15; // Reset Y position
            }

            doc.addImage(imgData, 'PNG', 10, yPos, 190, 100); // Add image to PDF
            yPos += 110; // Move down for the next chart
          }
        });

        doc.save(`${selectedNode}_report.pdf`);

      } catch (err) {
        console.error(err);
        setError("Failed to generate PDF.");
      }
      
      // Clean up
      setLoading(false);
      setChartConfigs([]);
      chartRefs.current = [];
    }, 500); // 500ms delay to ensure canvas is rendered

    return () => clearTimeout(timer); // Cleanup timer if component unmounts

  }, [chartConfigs, loading, selectedNode]); // Dependencies for the effect

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Report Generation</h1>
      
      {/* --- Control Panel --- */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          
          {/* Node Selector */}
          <div className="flex-1">
            <label htmlFor="node-select" className="block text-sm font-medium text-gray-700 mb-1">
              Select Node
            </label>
            <select
              id="node-select"
              value={selectedNode}
              onChange={(e) => {
                setSelectedNode(e.target.value);
                setError(null);
              }}
              className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm 
                         focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="">-- Please choose a node --</option>
              {nodes.map(node => (
                <option key={node.nodeId} value={node.nodeId}>
                  {node.nodeId}
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <button
            onClick={handleGenerateCSV}
            disabled={loading || !selectedNode}
            className="px-4 py-2 bg-green-600 text-white rounded-md font-semibold
                       hover:bg-green-700 transition-colors disabled:bg-gray-400"
          >
            {loading ? 'Working...' : 'Generate CSV'}
          </button>
          
          <button
            onClick={handleGeneratePDF}
            disabled={loading || !selectedNode}
            className="px-4 py-2 bg-red-600 text-white rounded-md font-semibold
                       hover:bg-red-700 transition-colors disabled:bg-gray-400"
          >
            {loading ? 'Working...' : 'Generate PDF'}
          </button>
        </div>
        
        {/* --- Messages --- */}
        {loading && <div className="mt-4 text-blue-600">Generating report...</div>}
        {error && <div className="mt-4 text-red-600">{error}</div>}
      </div>

      {/* --- Hidden Chart Renderer --- */}
      {/* This div renders the charts off-screen so we can capture their images */}
      <div className="absolute -left-[9999px] w-[800px]">
        {chartConfigs.map((config, index) => (
          <Line
            key={index}
            ref={(el) => (chartRefs.current[index] = el)} // Assign ref
            data={config.data}
            options={config.options}
          />
        ))}
      </div>
    </div>
  );
};

export default Reports;