import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, WMSTileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import Papa from "papaparse";
import { getCoordinates } from "./utils/geocoding";
import "leaflet/dist/leaflet.css";
import "./App.css";

// Fix for default marker icons in React-Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
   iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
   iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
   shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Hub Candidates Data
const hubCandidates = [
   // Utrecht region
   { name: "Port of Utrecht Lage Weide", region: "Utrecht", coordinates: [52.1134, 5.0601] },
   { name: "City Port Liesbosch", region: "Utrecht", coordinates: [52.0507, 5.1129] },
   { name: "Papendorp", region: "Utrecht", coordinates: [52.0689, 5.0811] },
   // Zuid-Holland region
   { name: "Rotterdam: Katendrecht area", region: "Zuid-Holland", coordinates: [51.8975, 4.4699] },
   { name: "Den Haag/Binckhorst", region: "Zuid-Holland", coordinates: [52.0705, 4.3007] },
   { name: "Leiden", region: "Zuid-Holland", coordinates: [52.1601, 4.497] },
];

// Helper function to offset overlapping markers
const offsetCoordinates = (projects) => {
   const coordMap = new Map();

   // Group projects by coordinates
   projects.forEach((project, index) => {
      const key = `${project.coordinates[0]},${project.coordinates[1]}`;
      if (!coordMap.has(key)) {
         coordMap.set(key, []);
      }
      coordMap.get(key).push({ ...project, originalIndex: index });
   });

   // Offset overlapping markers in a circle pattern
   const result = [];
   coordMap.forEach((projectsAtLocation, key) => {
      if (projectsAtLocation.length === 1) {
         result.push(projectsAtLocation[0]);
      } else {
         // Multiple projects at same location - create circular offset
         const radius = 0.015; // Offset radius in degrees
         projectsAtLocation.forEach((project, i) => {
            const angle = (2 * Math.PI * i) / projectsAtLocation.length;
            const offsetLat = project.coordinates[0] + radius * Math.cos(angle);
            const offsetLng = project.coordinates[1] + radius * Math.sin(angle);
            result.push({
               ...project,
               coordinates: [offsetLat, offsetLng],
               isOffset: true,
               groupSize: projectsAtLocation.length,
            });
         });
      }
   });

   return result;
};

// Custom marker icons based on status and completion year
const createCustomIcon = (status, type, completionYear) => {
   const colors = {
      "Construction (Aanleg)": "#e74c3c",
      "Construction (Aanleg - Pending)": "#e67e22",
      Planning: "#3498db",
      "Paused (Planning)": "#95a5a6",
      "Paused (Verkenning)": "#7f8c8d",
      "Exploration (Verkenning)": "#9b59b6",
      "Research (Onderzoek)": "#8e44ad",
      Program: "#2ecc71",
      "Planning/Construction": "#1abc9c",
   };

   const color = colors[status] || "#34495e";

   // Add year indicator if completion year exists
   const yearBadge = completionYear
      ? `<div style="
        position: absolute;
        top: -8px;
        right: -8px;
        background-color: #2c3e50;
        color: white;
        font-size: 10px;
        font-weight: bold;
        padding: 2px 4px;
        border-radius: 3px;
        border: 1px solid white;
    ">${completionYear}</div>`
      : "";

   return L.divIcon({
      className: "custom-marker",
      html: `<div style="position: relative;">
      <div style="
        background-color: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      "></div>
      ${yearBadge}
    </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
   });
};

// Custom Hub Candidate Icon (Square)
const createHubIcon = (region) => {
   // Distinct color for Hub Candidates
   const color = "#2c3e50";

   return L.divIcon({
      className: "hub-candidate-marker",
      html: `<div style="position: relative;">
      <div style="
        background-color: ${color};
        width: 20px;
        height: 20px;
        border-radius: 4px; /* Square with slight radius */
        border: 2px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        justify-content: center;
        align-items: center;
      ">
        <div style="width: 6px; height: 6px; background-color: white; border-radius: 50%;"></div>
      </div>
    </div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
   });
};

// Legend component
const Legend = () => {
   const statuses = [
      { status: "Construction (Aanleg)", color: "#e74c3c", label: "Construction" },
      { status: "Planning", color: "#3498db", label: "Planning" },
      { status: "Paused (Planning)", color: "#95a5a6", label: "Paused" },
      { status: "Exploration (Verkenning)", color: "#9b59b6", label: "Exploration" },
      { status: "Research (Onderzoek)", color: "#8e44ad", label: "Research" },
      { status: "Program", color: "#2ecc71", label: "Program" },
   ];

   return (
      <div className="legend">
         <h3>Status Legend</h3>
         {statuses.map(({ status, color, label }) => (
            <div key={status} className="legend-item">
               <div className="legend-color" style={{ backgroundColor: color }}></div>
               <span>{label}</span>
            </div>
         ))}
      </div>
   );
};

// Filter component
const FilterPanel = ({ projects, filters, setFilters }) => {
   const regions = [...new Set(projects.map((p) => p.Region))];
   const types = [...new Set(projects.map((p) => p.Type))];
   const statuses = [...new Set(projects.map((p) => p.Status))];

   // Get unique years from the projects
   const allYears = new Set();
   projects.forEach((p) => {
      if (p.All_Years) {
         try {
            const years = JSON.parse(p.All_Years.replace(/'/g, '"'));
            years.forEach((year) => allYears.add(year));
         } catch (e) {}
      }
   });
   const years = [...allYears].sort((a, b) => a - b);

   return (
      <div className="filter-panel">
         <h3>Filters</h3>

         <div className="filter-group">
            <label>Region:</label>
            <select value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })}>
               <option value="">All Regions</option>
               {regions.map((region) => (
                  <option key={region} value={region}>
                     {region}
                  </option>
               ))}
            </select>
         </div>

         <div className="filter-group">
            <label>Type:</label>
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
               <option value="">All Types</option>
               {types.map((type) => (
                  <option key={type} value={type}>
                     {type}
                  </option>
               ))}
            </select>
         </div>

         <div className="filter-group">
            <label>Status:</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
               <option value="">All Statuses</option>
               {statuses.map((status) => (
                  <option key={status} value={status}>
                     {status}
                  </option>
               ))}
            </select>
         </div>

         <div className="filter-group">
            <label>Completion Year:</label>
            <select
               value={filters.completionYear}
               onChange={(e) => setFilters({ ...filters, completionYear: e.target.value })}
            >
               <option value="">All Years</option>
               {years.map((year) => (
                  <option key={year} value={year}>
                     {year}
                  </option>
               ))}
            </select>
         </div>

         <div className="filter-group">
            <label>Year Range:</label>
            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
               <input
                  type="number"
                  placeholder="From"
                  value={filters.yearFrom}
                  onChange={(e) => setFilters({ ...filters, yearFrom: e.target.value })}
                  style={{ width: "70px" }}
               />
               <span>-</span>
               <input
                  type="number"
                  placeholder="To"
                  value={filters.yearTo}
                  onChange={(e) => setFilters({ ...filters, yearTo: e.target.value })}
                  style={{ width: "70px" }}
               />
            </div>
         </div>

         <button
            className="clear-filters"
            onClick={() =>
               setFilters({ region: "", type: "", status: "", completionYear: "", yearFrom: "", yearTo: "" })
            }
         >
            Clear Filters
         </button>
      </div>
   );
};

function App() {
   const [projects, setProjects] = useState([]);
   const [filteredProjects, setFilteredProjects] = useState([]);
   const [filters, setFilters] = useState({
      region: "",
      type: "",
      status: "",
      completionYear: "",
      yearFrom: "",
      yearTo: "",
   });
   const [loading, setLoading] = useState(true);
   const [showTable, setShowTable] = useState(false);

   // CEMT Classes with Colors
   const cemtClasses = [
      { label: "0", color: "#95a5a6" }, // Grey
      { label: "I", color: "#81c784" }, // Light Green
      { label: "II", color: "#4caf50" }, // Green
      { label: "III", color: "#2e7d32" }, // Dark Green
      { label: "IV", color: "#64b5f6" }, // Light Blue
      { label: "Va", color: "#2196f3" }, // Blue
      { label: "Vb", color: "#1565c0" }, // Dark Blue
      { label: "VIa", color: "#ba68c8" }, // Light Purple
      { label: "VIb", color: "#9c27b0" }, // Purple
      { label: "VIc", color: "#7b1fa2" }, // Dark Purple
   ];

   const [showWaterways, setShowWaterways] = useState(true);
   const [showHubCandidates, setShowHubCandidates] = useState(true);
   // Initialize with ALL classes selected
   const [cemtFilters, setCemtFilters] = useState(cemtClasses.map((c) => c.label));

   const handleCemtToggle = (value) => {
      setCemtFilters((prev) => {
         if (prev.includes(value)) {
            return prev.filter((c) => c !== value);
         }
         return [...prev, value];
      });
   };

   useEffect(() => {
      // Load and parse CSV
      fetch("/projects_structured_dates.csv")
         .then((response) => response.text())
         .then((csvText) => {
            Papa.parse(csvText, {
               header: true,
               skipEmptyLines: true,
               complete: (results) => {
                  const projectsWithCoords = results.data.map((project) => ({
                     ...project,
                     coordinates: getCoordinates(project.Location),
                  }));
                  setProjects(projectsWithCoords);
                  setFilteredProjects(projectsWithCoords);
                  setLoading(false);
               },
            });
         })
         .catch((error) => {
            console.error("Error loading CSV:", error);
            setLoading(false);
         });
   }, []);

   useEffect(() => {
      // Apply filters
      let filtered = projects;

      if (filters.region) {
         filtered = filtered.filter((p) => p.Region === filters.region);
      }
      if (filters.type) {
         filtered = filtered.filter((p) => p.Type === filters.type);
      }
      if (filters.status) {
         filtered = filtered.filter((p) => p.Status === filters.status);
      }
      if (filters.completionYear) {
         filtered = filtered.filter((p) => {
            const year = parseFloat(filters.completionYear);
            return p.Likely_Completion_Year && parseFloat(p.Likely_Completion_Year) === year;
         });
      }
      if (filters.yearFrom || filters.yearTo) {
         filtered = filtered.filter((p) => {
            if (!p.Likely_Completion_Year) return false;
            const year = parseFloat(p.Likely_Completion_Year);
            const from = filters.yearFrom ? parseFloat(filters.yearFrom) : -Infinity;
            const to = filters.yearTo ? parseFloat(filters.yearTo) : Infinity;
            return year >= from && year <= to;
         });
      }

      // Apply offset to overlapping markers
      const filteredWithOffset = offsetCoordinates(filtered);
      setFilteredProjects(filteredWithOffset);
   }, [filters, projects]);

   if (loading) {
      return <div className="loading">Loading projects...</div>;
   }

   // Construct CQL Filter and Key for Waterways
   let waterwaysCqlFilter = null;
   if (cemtFilters.length === cemtClasses.length) {
      // All classes selected -> No filter (Show All efficient)
      waterwaysCqlFilter = null;
   } else if (cemtFilters.length === 0) {
      // No classes selected -> Filter to nothing
      waterwaysCqlFilter = "1=2";
   } else {
      // Subset selected
      waterwaysCqlFilter = `classification IN ('${cemtFilters.join("','")}')`;
   }

   // Key to force re-render when params change
   const waterwaysLayerKey = `waterways-${cemtFilters.sort().join("-")}-${showWaterways}`;

   return (
      <div className="App">
         {showTable && (
            <div className="table-modal">
               <div className="table-container">
                  <div className="table-header">
                     <h2>Projects List ({filteredProjects.length} projects)</h2>
                     <button className="close-table-btn" onClick={() => setShowTable(false)}>
                        ✕
                     </button>
                  </div>
                  <div className="table-wrapper">
                     <table>
                        <thead>
                           <tr>
                              <th>Project Name</th>
                              <th>Region</th>
                              <th>Type</th>
                              <th>Location</th>
                              <th>Status</th>
                              <th>Year Range</th>
                              <th>Likely Completion</th>
                              <th>Source</th>
                           </tr>
                        </thead>
                        <tbody>
                           {filteredProjects.map((project, index) => (
                              <tr key={index}>
                                 <td>{project["Project Name"]}</td>
                                 <td>{project.Region}</td>
                                 <td>{project.Type}</td>
                                 <td>{project.Location}</td>
                                 <td>{project.Status}</td>
                                 <td>
                                    {project.Min_Year && project.Max_Year
                                       ? `${project.Min_Year} - ${project.Max_Year}`
                                       : "-"}
                                 </td>
                                 <td>
                                    {project.Likely_Completion_Year
                                       ? Math.floor(parseFloat(project.Likely_Completion_Year))
                                       : "-"}
                                 </td>
                                 <td>{project.Source}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
         )}

         <div className="content">
            <div className="sidebar">
               <header style={{ borderRadius: "8px", marginBottom: "10px", boxShadow: "0 2px 5px rgba(0, 0, 0, 0.1)" }}>
                  <h4>Netherlands Infrastructure Projects</h4>
                  <p>MIRT 2026</p>
                  <button className="show-table-btn" onClick={() => setShowTable(!showTable)}>
                     {showTable ? "Hide" : "Show"} Projects Table
                  </button>
               </header>

               <div className="filter-panel" style={{ marginBottom: "15px" }}>
                  <div
                     style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "10px",
                     }}
                  >
                     <h3 style={{ margin: 0 }}>Waterways (CEMT)</h3>
                     <label
                        className="switch"
                        style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}
                     >
                        <input
                           type="checkbox"
                           checked={showWaterways}
                           onChange={(e) => setShowWaterways(e.target.checked)}
                           style={{ cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "12px" }}>{showWaterways ? "On" : "Off"}</span>
                     </label>
                  </div>

                  {showWaterways && (
                     <div className="cemt-filters">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                           {cemtClasses.map((cls) => {
                              const isSelected = cemtFilters.includes(cls.label);
                              return (
                                 <button
                                    key={cls.label}
                                    // onClick={() => handleCemtToggle(cls.label)}
                                    style={{
                                       padding: "4px 8px",
                                       borderRadius: "4px",
                                       border: isSelected ? `2px solid ${cls.color}` : "1px solid #ddd",
                                       backgroundColor: isSelected ? cls.color : "#f8f9fa",
                                       color: isSelected ? "white" : "#999",
                                       cursor: "pointer",
                                       fontSize: "12px",
                                       flex: "1 0 30px",
                                       textAlign: "center",
                                       fontWeight: isSelected ? "bold" : "normal",
                                       boxShadow: isSelected ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                                       opacity: isSelected ? 1 : 0.6,
                                    }}
                                 >
                                    {cls.label}
                                 </button>
                              );
                           })}
                        </div>
                        {/* <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                                    <button 
                                        onClick={() => setCemtFilters(cemtClasses.map(c => c.label))}
                                        style={{
                                            flex: 1,
                                            padding: '4px', 
                                            fontSize: '11px', 
                                            backgroundColor: '#eee', 
                                            border: 'none', 
                                            borderRadius: '4px',
                                            cursor: 'pointer' 
                                        }}
                                    >
                                        Show All
                                    </button>
                                    <button 
                                        onClick={() => setCemtFilters([])}
                                        style={{
                                            flex: 1,
                                            padding: '4px', 
                                            fontSize: '11px', 
                                            backgroundColor: '#eee', 
                                            border: 'none', 
                                            borderRadius: '4px',
                                            cursor: 'pointer' 
                                        }}
                                    >
                                        Hide All
                                    </button>
                                </div> */}
                     </div>
                  )}
               </div>

               <div className="filter-panel" style={{ marginBottom: "15px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                     <h3 style={{ margin: 0 }}>Hub Candidates</h3>
                     <label
                        className="switch"
                        style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}
                     >
                        <input
                           type="checkbox"
                           checked={showHubCandidates}
                           onChange={(e) => setShowHubCandidates(e.target.checked)}
                           style={{ cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "12px" }}>{showHubCandidates ? "On" : "Off"}</span>
                     </label>
                  </div>
               </div>

               <FilterPanel projects={projects} filters={filters} setFilters={setFilters} />
               <Legend />
               <div className="stats">
                  <h3>Statistics</h3>
                  <p>
                     Total Projects: <strong>{projects.length}</strong>
                  </p>
                  <p>
                     Showing: <strong>{filteredProjects.length}</strong>
                  </p>
               </div>
            </div>

            <div className="map-container">
               <MapContainer center={[52.1326, 5.2913]} zoom={8} style={{ height: "100%", width: "100%" }}>
                  <TileLayer
                     attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                     url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                  />

                  {showWaterways && (
                     <WMSTileLayer
                        key={waterwaysLayerKey}
                        url="https://service.pdok.nl/rws/vnds/wms/v2_0"
                        layers="l_navigability"
                        format="image/png"
                        transparent={true}
                        styles="bevaarbaarheid"
                        attribution='&copy; <a href="https://www.pdok.nl">PDOK</a>'
                        params={{
                           cql_filter: waterwaysCqlFilter,
                        }}
                     />
                  )}

                  {filteredProjects.map((project, index) => {
                     const completionYear = project.Likely_Completion_Year
                        ? Math.floor(parseFloat(project.Likely_Completion_Year))
                        : null;

                     return (
                        <Marker
                           key={index}
                           position={project.coordinates}
                           icon={createCustomIcon(project.Status, project.Type, completionYear)}
                        >
                           <Popup>
                              <div className="popup-content">
                                 <h3>{project["Project Name"]}</h3>
                                 {project.isOffset && (
                                    <p style={{ color: "#e67e22", fontSize: "12px", marginBottom: "8px" }}>
                                       📍 {project.groupSize} projects at this location
                                    </p>
                                 )}
                                 <p>
                                    <strong>Region:</strong> {project.Region}
                                 </p>
                                 <p>
                                    <strong>Type:</strong> {project.Type}
                                 </p>
                                 <p>
                                    <strong>Location:</strong> {project.Location}
                                 </p>
                                 <p>
                                    <strong>Status:</strong> {project.Status}
                                 </p>
                                 {project.Min_Year && project.Max_Year && (
                                    <p>
                                       <strong>Year Range:</strong> {project.Min_Year} - {project.Max_Year}
                                    </p>
                                 )}
                                 {project.Likely_Completion_Year && (
                                    <p>
                                       <strong>Likely Completion:</strong> {completionYear}
                                    </p>
                                 )}
                                 <p>
                                    <strong>Source:</strong> {project.Source}
                                 </p>
                              </div>
                           </Popup>
                        </Marker>
                     );
                  })}

                  {showHubCandidates &&
                     hubCandidates.map((hub, index) => (
                        <Marker key={`hub-${index}`} position={hub.coordinates} icon={createHubIcon(hub.region)}>
                           <Popup>
                              <div className="popup-content">
                                 <h3>{hub.name}</h3>
                                 <p style={{ color: "#2c3e50", fontWeight: "bold" }}>Hub Candidate</p>
                                 <p>
                                    <strong>Region:</strong> {hub.region}
                                 </p>
                                 <p>
                                    <strong>Coordinates:</strong> {hub.coordinates[0]}, {hub.coordinates[1]}
                                 </p>
                              </div>
                           </Popup>
                        </Marker>
                     ))}
               </MapContainer>
            </div>
         </div>
      </div>
   );
}

export default App;
