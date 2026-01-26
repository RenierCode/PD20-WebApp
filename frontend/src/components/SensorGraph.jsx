// File: src/components/SensorGraph.js

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import { LuClock } from 'react-icons/lu';
// Using Font Awesome icon for broader compatibility
import { FaExclamationTriangle } from 'react-icons/fa';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  TimeSeriesScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register all necessary components
ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  TimeSeriesScale
);

const API_URL = 'http://127.0.0.1:8000';

const timeRanges = [
  { key: '10m', label: '10 Minutes' },
  { key: '30m', label: '30 Minutes' },
  { key: '1h', label: '1 Hour' },
  { key: '6h', label: '6 Hours' },
  { key: '24h', label: '24 Hours' },
  { key: '7d', label: '7 Days' },
];

const BRIGHT_COLORS = [
  '#E6194B', '#3CB44B', '#0082C8', '#F58231',
  '#911EB4', '#46F0F0', '#F032E6', '#FFE119',
];

const SensorGraph = ({ nodeId, sensorKey, initialData, className = '', showAnomalies, onAnomalyNotification, anomalyCount = 0, onShowAnomalyDetails, timeRange = '24h', fromNow = true }) => {
    const [chartData, setChartData] = useState({ datasets: [] });
    // Separate loading states
    const [isInitialLoading, setIsInitialLoading] = useState(true); // For manual changes/first load
    const [isPolling, setIsPolling] = useState(false); // For background polls
    const [error, setError] = useState(null);

    const [graphColor] = useState(() => {
      const randomIndex = Math.floor(Math.random() * BRIGHT_COLORS.length);
      return BRIGHT_COLORS[randomIndex];
    });

        // Track last anomaly count so we don't spam notifications
        const lastAnomalyCountRef = useRef(0);

    // Safer way to get last data point
    const lastDataPoint = chartData?.datasets?.[0]?.data.length > 0
      ? chartData.datasets[0].data[chartData.datasets[0].data.length - 1]
      : undefined;

    // Memoized function to format data for Chart.js
    const formatChartData = useCallback((data) => {
        const chartPoints = (data || [])
            .filter(d => d?.sensorData?.[sensorKey] !== null && d?.sensorData?.[sensorKey] !== undefined)
            .map(d => ({
                x: new Date(d.timestamp),
                y: d.sensorData[sensorKey]
            }));
        return {
            datasets: [{
                label: sensorKey,
                data: chartPoints,
                borderColor: graphColor,
                backgroundColor: 'rgba(255, 255, 255, 0.1)', // Keep background subtle
                tension: 0.1,
                pointRadius: 2,
            }],
        };
    }, [sensorKey, graphColor]);


    // --- Combined Fetch Logic ---
    // Memoized function to fetch both readings and anomalies
    const fetchData = useCallback(async (isPoll = false) => {
        // Set appropriate loading state
        if (!isPoll) setIsInitialLoading(true); else setIsPolling(true);
        setError(null); // Clear previous errors

        try {
            // Fetch readings using the timeRange prop from parent
            let readingsPromise = axios.get(`${API_URL}/api/nodes/${nodeId}/readings?range=${timeRange}&sensor=${sensorKey}&fromNow=${fromNow}`).then(res => res.data);

            // Wait for readings
            const readingsData = await readingsPromise;

            // Format main line data
            const finalChartData = formatChartData(readingsData);

            // If anomalies should be shown, extract them from readingsData
            if (showAnomalies) {
                const anomalyPoints = (readingsData || []).filter(d => d && d.anomalies && Array.isArray(d.anomalies) && d.anomalies.includes(sensorKey) && d.sensorData && d.sensorData[sensorKey] != null)
                    .map(d => ({ x: new Date(d.timestamp), y: d.sensorData[sensorKey] }));
                if (anomalyPoints.length > 0) {
                    finalChartData.datasets.push({
                        label: 'Anomaly',
                        data: anomalyPoints,
                        backgroundColor: '#FF0000', borderColor: '#FF0000',
                        pointRadius: 6, pointHoverRadius: 8, showLine: false,
                    });

                    // Notify parent about anomalies (avoid repeated notifications)
                    try {
                        if (onAnomalyNotification) {
                            const count = anomalyPoints.length;
                            const last = lastAnomalyCountRef.current || 0;
                            if (count !== last) {
                                const anomaliesPayload = anomalyPoints.map(p => ({ timestamp: p.x.toISOString(), value: p.y }));
                                onAnomalyNotification({
                                    sensorKey,
                                    count,
                                    anomalies: anomaliesPayload,
                                    message: `${count} anomaly${count !== 1 ? 'ies' : ''} detected for ${sensorKey}`,
                                    nodeId
                                });
                                lastAnomalyCountRef.current = count;
                            }
                        }
                    } catch (e) {
                        console.error('Error sending anomaly notification', e);
                    }
                } else {
                    // If previously had anomalies but now cleared, reset counter
                    if (lastAnomalyCountRef.current && lastAnomalyCountRef.current > 0) {
                        lastAnomalyCountRef.current = 0;
                    }
                }
            }

            setChartData(finalChartData); // Update the chart state

        } catch (err) {
            setError(`Failed data load.`); // Set error state
            console.error(err);
        } finally {
             // Clear appropriate loading state
            if (!isPoll) setIsInitialLoading(false);
            setIsPolling(false);
        }
    }, [nodeId, sensorKey, timeRange, fromNow, showAnomalies, graphColor, formatChartData]); // Use props from parent

    // Effect for initial load and manual changes (range, anomalies toggle, fromNow)
    useEffect(() => {
        fetchData(false); // Fetch as non-poll on these changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeRange, fromNow, showAnomalies]); // Dependencies are timeRange, fromNow, and showAnomalies from parent

    // If the parent passes updated `initialData` (NodeDetailPage polling), update chart immediately
    useEffect(() => {
        if (!initialData) return;
        try {
            const finalChartData = formatChartData(initialData);

            if (showAnomalies) {
                const anomalyPoints = (initialData || []).filter(d => d && d.anomalies && Array.isArray(d.anomalies) && d.anomalies.includes(sensorKey) && d.sensorData && d.sensorData[sensorKey] != null)
                    .map(d => ({ x: new Date(d.timestamp), y: d.sensorData[sensorKey] }));
                if (anomalyPoints.length > 0) {
                    finalChartData.datasets.push({
                        label: 'Anomaly',
                        data: anomalyPoints,
                        backgroundColor: '#FF0000', borderColor: '#FF0000',
                        pointRadius: 6, pointHoverRadius: 8, showLine: false,
                    });
                }
            }

            setChartData(finalChartData);
        } catch (e) {
            // ignore formatting errors here
            console.error('Failed to apply initialData to chart', e);
        }
    }, [initialData, showAnomalies, sensorKey, formatChartData]);


    // --- Polling useEffect ---
    useEffect(() => {
        const pollInterval = 5000; // Poll every 5 seconds (adjust as needed)
        console.log(`Setting up polling for ${sensorKey}: ${pollInterval / 1000}s`);

        // Set up the interval
        const intervalId = setInterval(() => {
            console.log(`Polling for ${sensorKey}...`);
            fetchData(true); // Fetch as a background poll update
        }, pollInterval);

        // Cleanup function to clear the interval when the component unmounts
        // or when dependencies of fetchData change causing this effect to re-run
        return () => {
            console.log(`Clearing polling interval for ${sensorKey}.`);
            clearInterval(intervalId);
        };
    }, [fetchData, sensorKey]); // Re-setup interval if fetchData changes

    // Chart.js configuration options
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false, // Important for fixed height container
        interaction: { mode: 'x', intersect: false, }, // Use 'x' mode for tooltip
        plugins: {
            legend: { position: 'top', },
            title: { display: true, text: `Sensor: ${sensorKey.toUpperCase()}` },
            tooltip: { mode: 'x', intersect: false, }, // Use 'x' mode here too
        },
        scales: {
          x: {
            type: 'time', // Use the time scale
            max: lastDataPoint ? lastDataPoint.x.getTime() : undefined, // Optional: limit axis
            time: {
              tooltipFormat: 'PP pp', // Format for the hover tooltip

              // --- LET CHART.JS CHOOSE THE UNIT ---
              // DO NOT specify 'unit: 'hour'' or similar here.
              // Just provide the display formats it *can* use.
              displayFormats: {
                second: 'h:mm:ss a',  // For very short ranges
                minute: 'h:mm a',     // For 10m, 30m ranges
                hour: 'h a',          // For 1h, 6h ranges
                day: 'MMM d',         // For 24h, 7d ranges
                month: 'MMM yyyy'     // For longer ranges
              }
            },
            ticks: {
              autoSkip: true,      // Automatically hide ticks to prevent overlap
              maxTicksLimit: 10,   // Limit the number of ticks shown
                // --- ALLOW ROTATION ONLY IF NEEDED ---
              maxRotation: 45,     // Allow rotating up to 45 degrees
            minRotation: 0       // But prefer 0 degrees (horizontal)
            }
          },
          y: {
        // Optional: Add title or other y-axis settings if needed
        }
      }
    };

    // Determine if there's any data to display
    const hasData = chartData && chartData.datasets.some(ds => ds.data.length > 0);
    // Determine overall loading state for placeholder text
    const isLoading = isInitialLoading || isPolling;

    // Get label for current time range
    const timeRangeLabel = timeRanges.find(r => r.key === timeRange)?.label || timeRange;

    return (
        <div className={`bg-white p-4 rounded-lg shadow-md ${className}`}>
            {/* Header section with indicators */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-md text-sm">
                        <LuClock size={16} />
                        <span>{timeRangeLabel}</span>
                    </div>
                    <div className={`px-2 py-1 rounded-md text-xs font-medium ${fromNow ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-green-50 text-green-600 border border-green-200'}`}>
                        {fromNow ? 'Now' : 'Data'}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {showAnomalies && (<FaExclamationTriangle size={16} className="text-red-500" title="Anomaly detection active" />)}
                    {/* Per-sensor anomaly badge (shows count and opens details via callback) */}
                    {anomalyCount > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-100 rounded-md text-sm font-semibold">
                                {anomalyCount}
                            </div>
                            <button
                                onClick={() => onShowAnomalyDetails && onShowAnomalyDetails(sensorKey)}
                                className="text-xs px-2 py-0.5 bg-white border border-red-200 rounded-md text-red-600 font-medium"
                            >
                                Show details
                            </button>
                        </div>
                    )}
                    {/* Show subtle polling indicator only during background polls */}
                    {isPolling && !isInitialLoading && <span className="text-xs text-gray-500">Updating...</span>}
                    {/* Show main loading indicator only on initial/manual fetch */}
                    {isInitialLoading && <span className="text-sm text-blue-600">Loading...</span>}
                    {error && <span className="text-sm text-red-600">{error}</span>}
                </div>
            </div>

            {/* Chart container with fixed height */}
            <div className="h-80">
                {hasData ? (
                    <Line options={chartOptions} data={chartData} />
                ) : (
                    // Placeholder when no data or during initial load
                    <div className="flex items-center justify-center h-full">
                        <p className="text-center text-gray-500">
                            {isLoading ? 'Loading...' : `No data available for "${sensorKey}" in this time range.`}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SensorGraph;