import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// --- Leaflet Icon Fix ---
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;
// --- End Icon Fix ---

const API_URL = 'http://127.0.0.1:8000';

const MapPage = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Set a default center for the map
  const mapCenter = [14.65, 121.05]; // Default center (e.g., Quezon City)

  // Predefined locations to show on the map. We'll randomly assign nodes to these.
  const LOCATIONS = [
    { id: 'm1', name: 'Subic Pier 1', lat: 14.7938, lng: 120.2716 },
    { id: 'm2', name: 'Olongapo Station', lat: 14.8376, lng: 120.2716 },
    { id: 'm3', name: 'Subic River', lat: 14.8156, lng: 120.2831 }
  ];

  // Compute bounds that cover all predefined locations (with small padding)
  const latitudes = LOCATIONS.map(l => l.lat);
  const longitudes = LOCATIONS.map(l => l.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const padding = 0.01; // small padding so markers aren't at the very edge
  const bounds = [[minLat - padding, minLng - padding], [maxLat + padding, maxLng + padding]];

  const fetchNodes = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/nodes`);
      // Deterministic assignment: sort nodes by ID and assign in round-robin to LOCATIONS
      const allNodes = (response.data || []).slice().sort((a, b) => (a._id || a.nodeId || '').localeCompare(b._id || b.nodeId || ''));
      const assigned = allNodes.map((n, i) => {
        const loc = LOCATIONS[i % LOCATIONS.length];
        return {
          ...n,
          // set a synthetic location object expected by the map component
          location: { latitude: loc.lat, longitude: loc.lng },
          _assignedLocationName: loc.name,
        };
      });

      setNodes(assigned);
      setError(null);
    } catch (err) {
      setError("Failed to fetch nodes, or nodes have no location data.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, []);
  
  if (loading) return <div>Loading map and node data...</div>;
  if (error) return <div className="text-red-600 font-semibold">{error}</div>;

  return (
    <div>
      <h1 className="text-4xl font-bold mb-4">Node Map</h1>
      <p className="text-gray-600 mb-6">
        Displaying the last known location of all sensor nodes.
      </p>
      
      {/* Container for the map with Tailwind classes */}
      <div className="h-[70vh] w-full rounded-lg shadow-md overflow-hidden z-10">
        <MapContainer bounds={bounds} className="w-full h-full">
          
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          
          {/* Loop through nodes and create markers */}
          {nodes.map(node => (
            <Marker 
              key={node.nodeId} 
              position={[node.location.latitude, node.location.longitude]}
            >
              <Popup>
                {/* Popup content - styled with simple HTML and Tailwind */}
                <div className="w-[250px]">
                  <h3 className="font-bold text-lg mb-2">{node.nodeId}</h3>
                  <p><b>Status:</b> {node.status}</p>
                  <p><b>Sensors:</b> {node.sensors.join(', ')}</p>
                  {node._assignedLocationName && (
                    <p><b>Location:</b> {node._assignedLocationName}</p>
                  )}
                  {node.location && (
                    <p className="text-sm text-gray-600"><b>Coordinates:</b> {`${Number(node.location.latitude).toFixed(4)}, ${Number(node.location.longitude).toFixed(4)}`}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
          
        </MapContainer>
      </div>
    </div>
  );
};

export default MapPage;