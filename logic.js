// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
let jsonData = null;
let centroidLookup = {};
let pingTableTabulator = null;
let hourChart = null;
let amperageChart = null;
let bmsChart = null;
let batteryCentroidChart = null;
let batteryHourChart = null;
let batteryAmperageChart = null;
let currentBatteryId = null;
let batteryUseLocalHour = true;
let batteryDetectedTimeZone = "UTC";


let centroidMarkers = {};
let centroidLayer;
let map;
let useLocalHour = true;
let detectedTimeZone = "UTC";
let currentDetailPings = [];
let dataDate = null; // ISO date string (YYYY-MM-DD) extracted from filename
let currentDetailCentroid = null;
let selectedCentroidLayer = null;

// ------------------------------------------------------------
// Init: map & UI
// ------------------------------------------------------------
window.onload = () => {
    setupPivotList();
    setupMap();
    setupHourToggle();
};

function setupHourToggle() {
    try {
        detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        batteryDetectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (e) {
        detectedTimeZone = "UTC";
        batteryDetectedTimeZone = "UTC";
    }

    const tzSpan = document.getElementById("detectedTimezone");
    if (tzSpan) tzSpan.textContent = detectedTimeZone;

    const cb = document.getElementById("hourLocalToggle");
    if (cb) {
        cb.checked = true; // default UTC
        cb.addEventListener("change", () => {
            useLocalHour = cb.checked;
            updateHourChart(currentDetailPings);
            batteryUseLocalHour = cb.checked;
            if (currentBatteryId) {
                const batteryPings = jsonData.pings.filter(p => p.bms_id === currentBatteryId);
                updateBatteryHourChart(batteryPings);
                displaySwapFlow(currentBatteryId)
            }
        });
    }
}

// ------------------------------------------------------------
// PIVOT LIST / SELECT SYNC
// ------------------------------------------------------------
function setupPivotList() {
    const sortableList = document.getElementById("pivotList");
    const groupBySelect = document.getElementById("pivotSelect");

    sortableList.addEventListener("click", e => {
        if (e.target.tagName === "LI") {
            e.target.classList.toggle("selected");
            syncSelect();
        }
    });

    Sortable.create(sortableList, {
        animation: 150,
        onSort: syncSelect
    });

    function syncSelect() {
        groupBySelect.innerHTML = "";
        [...sortableList.querySelectorAll("li.selected")].forEach(li => {
            const opt = document.createElement("option");
            opt.value = li.dataset.value;
            opt.textContent = li.textContent;
            opt.selected = true;
            groupBySelect.appendChild(opt);
        });
        updatePivot();
    }
}

// ------------------------------------------------------------
// FILE LOADING
// ------------------------------------------------------------
document.getElementById("fileInput").addEventListener("change", async evt => {
    const file = evt.target.files[0];

    // ---------- NEW DATE EXTRACTION ----------
    // filename expected to contain ISO date at the end before extension
    // Example: charge_data_2025-02-17.json → extracts "2025-02-17"


    jsonData = JSON.parse(await file.text());
    jsonData.centroids.forEach(c => (centroidLookup[c.id] = c));

    const isoDate = jsonData.date
    // Update the big title
    document.getElementById("fileDateTitle").textContent = "Data Date: " + isoDate;
    // store data date for hour labeling (if available)
    dataDate = isoDate !== "Unknown Date" ? isoDate : null;
    // -----------------------------------------

    renderAll();
});


function renderAll() {
    renderTable(jsonData.pings);
    renderCentroids(jsonData.centroids);
}

// ------------------------------------------------------------
// GET SELECTED OPTIONS
// ------------------------------------------------------------
function getSelectedPivotFields() {
    return [...document.getElementById("pivotSelect").options]
        .filter(o => o.selected)
        .map(o => o.value);
}

// ------------------------------------------------------------
// RENDER TABLE
// ------------------------------------------------------------

function getGroupDepthOutwards(group) {
    const subs = group.getSubGroups();

    // No subgroups → depth is 1 (this group only)
    if (!subs || subs.length === 0) {
        return 1;
    }

    // Recursively check depths of each subgroup
    let maxDepth = 0;
    for (const sub of subs) {
        const depth = getGroupDepth(sub);
        if (depth > maxDepth) {
            maxDepth = depth;
        }
    }

    // Add 1 for the current group level
    return 1 + maxDepth;
}

function getGroupDepth(group) {
    let depth = 1;
    let parent = group.getParentGroup();

    while (parent) {
        depth++;
        parent = parent.getParentGroup();
    }

    return depth;
}

function getAllRows(group) {
    let rows = [];

    // 1. Add this group's own rows
    if (typeof group.getRows === 'function') {
        rows.push(...group.getRows());
    }

    // 2. Recurse into subgroups (if any)
    if (typeof group.getSubGroups === 'function') {
        const subs = group.getSubGroups();
        if (subs && subs.length > 0) {
            subs.forEach(sub => {
                rows.push(...getAllRows(sub));
            });
        }
    }

    return rows;
}

function getAllLastLevelGroups(table) {
    return table.getGroups()
        .flatMap(g => getAllLastLevelGroupsRecursive(g));
}

function getAllLastLevelGroupsRecursive(group) {
    const subs = group.getSubGroups?.() || [];

    return subs.length === 0
        ? [group]
        : subs.flatMap(g => getAllLastLevelGroupsRecursive(g));
}


function sort_by_soc(tabulatorTable) {
    tabulatorTable.setSort([
        { column: "group_sort_key_5", dir: "desc" },
        { column: "group_sort_key_4", dir: "desc" },
        { column: "group_sort_key_3", dir: "desc" },
        { column: "group_sort_key_2", dir: "desc" },
        { column: "group_sort_key_1", dir: "desc" },
    ])
}

var autoSorted = false;

function renderTable(pings) {
    const tableData = pings.map(p => {
        const cent = centroidLookup[p.centroid_id] || {};
        return {
            bms: p.bms_id,
            country: p.country,
            centroid_id: p.centroid_id,
            centroid_name: cent.name,
            centroid_type: cent.type,
            hour: p.hour,
            amperage: p.amperage,
            soc_lost: p.soc_lost,
            group_sort_key_1: "0000000000",
            group_sort_key_2: "0000000000",
            group_sort_key_3: "0000000000",
            group_sort_key_4: "0000000000",
            group_sort_key_5: "0000000000"
        };
    });

    const groupFields = getSelectedPivotFields();

    // update existing table
    if (pingTableTabulator) {
        pingTableTabulator.setGroupBy(groupFields);
        pingTableTabulator.setData(tableData)
        return;
    }


    // create table
    pingTableTabulator = new TabulatorFull$1("#pingTable", {
        renderVertical: "basic",
        data: tableData,
        layout: "fitColumns",
        height: "100%",
        headerFilter: true,
        groupBy: groupFields,
        groupToggleElement: "arrow",
        groupStartOpen: false,
        groupClosedShowCalcs: true,
        rowFormatter: function (row) {
            const el = row.getElement();
        },

        initialSort: [
            { column: "group_sort_key_5", dir: "desc" },
            { column: "group_sort_key_4", dir: "desc" },
            { column: "group_sort_key_3", dir: "desc" },
            { column: "group_sort_key_2", dir: "desc" },
            { column: "group_sort_key_1", dir: "desc" },
        ],

        groupHeader: function (value, count, data, group) {
            const sum = data.reduce((acc, row) => acc + row.soc_lost, 0);
            let depth = getGroupDepth(group);

            const paddedSum = String(sum).padStart(10, "0");

            var rows = getAllRows(group);
            rows.forEach(pingrow => {
                let group_label_string = "group_sort_key_" + String(depth);
                pingrow.update({ [group_label_string]: paddedSum });
            });

            const container = document.createElement("div");
            container.className = "group-header-container";

            // Label
            const labelDiv = document.createElement("div");
            labelDiv.className = "group-header-label";
            labelDiv.textContent = value;
            container.appendChild(labelDiv);

            // SOC Lost
            const socDiv = document.createElement("div");
            socDiv.className = "group-header-soc";
            socDiv.textContent = `SOC Lost: ${sum}`;
            container.appendChild(socDiv);

            // Export Button
            const btn = document.createElement("button");
            btn.textContent = "Export CSV";
            btn.addEventListener("click", function (e) {
                exportGroupCSV(group, value);
            });
            container.appendChild(btn);

            return container;
        },

        columns: [
            { title: "BMS", field: "bms", headerFilter: "input", visible: true },
            { title: "Country", field: "country", headerFilter: "input", visible: true },
            { title: "Centroid ID", field: "centroid_id", headerFilter: "input", visible: false },
            { title: "Centroid Name", field: "centroid_name", headerFilter: "input", visible: true },
            { title: "Type", field: "centroid_type", headerFilter: "input", visible: true },
            { title: "Hour", field: "hour", sorter: "number", visible: false },
            { title: "Amperage", field: "amperage", headerFilter: true, visible: true },
            { title: "SOC Lost", field: "soc_lost", visible: false },
            { title: "GroupSort1", field: "group_sort_key_1", visible: false },
            { title: "GroupSort2", field: "group_sort_key_2", visible: false },
            { title: "GroupSort3", field: "group_sort_key_3", visible: false },
            { title: "GroupSort4", field: "group_sort_key_4", visible: false },
            { title: "GroupSort5", field: "group_sort_key_5", visible: false },
        ],

    });

    pingTableTabulator.on("rowMouseEnter", function (e, row) {
        const id = String(row.getData().centroid_id);
        highlightCentroid(id);
    });

    pingTableTabulator.on("rowMouseLeave", function (e, row) {
        const id = String(row.getData().centroid_id);
        unhighlightCentroid(id);
    });

    pingTableTabulator.on("renderComplete", function () {

        if (!autoSorted) {
            autoSorted = true;
            sort_by_soc(pingTableTabulator);
        } else if (autoSorted) {
            const lastLevelGroups = getAllLastLevelGroups(pingTableTabulator);
            lastLevelGroups.forEach(element => {
                const el = element.getElement();
                const toggle = el.querySelector(".tabulator-group-toggle");
                if (toggle) {
                    toggle.style.display = "none";     // hide it
                    toggle.onclick = null;             // disable click
                }
            });
        }
        else {
            return;
        }

    });

    pingTableTabulator.on("groupMouseEnter", function (e, group) {
        const rows = getAllRows(group);

        // build unique ID set
        const ids = new Set();
        rows.forEach(row => {
            const id = row.getData().centroid_id;
            if (id != null) ids.add(String(id));
        });

        // highlight all
        ids.forEach(id => highlightCentroid(id));
    });


    pingTableTabulator.on("groupMouseLeave", function (e, group) {
        const rows = getAllRows(group);

        const ids = new Set();
        rows.forEach(row => {
            const id = row.getData().centroid_id;
            if (id != null) ids.add(String(id));
        });

        // unhighlight all
        ids.forEach(id => unhighlightCentroid(id));
    });


    pingTableTabulator.on("groupClick", function (e, group) {
        const rows = getAllRows(group);

        // Build unique centroid-ID set
        const ids = new Set();
        const station_names = new Set();
        rows.forEach(row => {
            const id = row.getData().centroid_id;
            if (id != null) ids.add(String(id));
            const name = row.getData().centroid_name;
            if (name) station_names.add(name);
        });

        // Compute and zoom to bounds
        const latlngs = [];
        ids.forEach(id => {
            const c = centroidLookup[id];
            if (c) latlngs.push([c.latitude, c.longitude]);
        });

        if (latlngs.length > 0) {
            const bounds = L.latLngBounds(latlngs);
            map.flyToBounds(bounds, { padding: [50, 50], animate: false });
        }
        // If this group contains exactly one unique centroid, open its details
        if (station_names.size === 1) {
            const onlyId = [...ids][0];
            const centroid = centroidLookup[onlyId];
            if (centroid) showCentroidDetails(centroid);
        }

        const bmsSet = new Set(rows.map(r => r.getData().bms).filter(Boolean));
        if (bmsSet.size === 1) {
            const bmsId = [...bmsSet][0];
            showBatteryDetails(bmsId);
        }
    });

    pingTableTabulator.on("groupVisibilityChanged", function (group) {
        pingTableTabulator.setSort(pingTableTabulator.getSorters());
    });

}

// ------------------------------------------------------------
// MAP & CHARTS
// ------------------------------------------------------------
function setupMap() {
    map = L.map("map").setView([0, 0], 2);
    centroidLayer = L.layerGroup().addTo(map);

    // layer to show the currently-selected centroid (blue highlight)
    selectedCentroidLayer = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    // Update visibility warning for the currently-open centroid when the map finishes moving
    map.on('moveend', () => {
        if (currentDetailCentroid) updateCentroidVisibilityWarning(currentDetailCentroid);
    });
}

function renderCentroids(centroids) {
    centroidLayer.clearLayers();
    centroidMarkers = {};

    centroids.forEach(c => {
        const color = c.type === "station" ? "green" : "red";

        const marker = L.circleMarker([c.latitude, c.longitude], {
            radius: 7,
            color,
            fillColor: color,
            fillOpacity: 0.8
        }).addTo(centroidLayer)
            .on("click", () => showCentroidDetails(c));

        marker._centroidData = c;
        centroidMarkers[c.id] = marker;
    });
}

function highlightCentroid(id) {
    const m = centroidMarkers[id];
    if (!m) return;
    m.setStyle({ radius: 12, fillColor: "yellow", color: "black", weight: 2, stroke: true, fillOpacity: 1, outline: "black" });
    m.bringToFront()
}

function unhighlightCentroid(id) {
    const m = centroidMarkers[id];
    if (!m) return;
    const c = m._centroidData;
    const color = c.type === "station" ? "green" : "red";
    m.setStyle({ radius: 7, fillColor: color, color, fillOpacity: 0.8 });
}

function showCentroidDetails(c) {
    const pings = jsonData.pings.filter(p => centroidLookup[p.centroid_id].name === c.name);
    currentDetailPings = pings;
    currentDetailCentroid = c;

    const totalSoc = pings.reduce((s, p) => s + p.soc_lost, 0);
    const gmUrl = `https://www.google.com/maps?q=${c.latitude},${c.longitude}`;

    document.getElementById("centroidDetails").innerHTML = `
        <b>${c.name}</b><br>
        Type: ${c.type}<br>
        Lat: ${c.latitude}<br>
        Lon: ${c.longitude}<br>
        <a href="${gmUrl}" target="_blank" style="color:#0077cc;text-decoration:underline;">
            Open in Google Maps
        </a>
        <br><br>
        <button id="jumpToMapButton" style="padding:6px 8px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer">Jump to map</button>
        <br><br>
        <b>Total SOC Lost:</b> ${totalSoc}
        <div id="centroidVisibilityWarning" style="color:#a00;margin-top:8px;display:none;"></div>
    `;

    // attach click handler to jump the map to this centroid
    const jumpBtn = document.getElementById("jumpToMapButton");
    if (jumpBtn) {
        jumpBtn.addEventListener("click", () => {
            if (map && c.latitude != null && c.longitude != null) {
                // zoom level chosen to show centroid context; adjust if needed
                try {
                    map.flyTo([c.latitude, c.longitude], 20, { animate: false });
                } catch (e) {
                    map.setView([c.latitude, c.longitude], 20);
                }
            }
        });
    }

    const bms_id_set = new Set(pings.map(p => p.bms_id).filter(Boolean));
    if (bms_id_set.size === 1) {
        const onlyBmsId = [...bms_id_set][0];
        showBatteryDetails(onlyBmsId);
    }

    // update visibility warning now that details are rendered
    updateCentroidVisibilityWarning(c);

    // show blue selected-centroid highlight
    highlightSelectedCentroid(c);

    updateHourChart(currentDetailPings);
    updateAmperageChart(pings);
    updateBmsChart(pings);
}




function updateHourChart(pings) {
    pings = pings || [];

    // Aggregate by UTC hour for the data date (0-23). This preserves continuous-day ordering.
    const counts = Array(24).fill(0);
    pings.forEach(p => {
        const hour = Number(p.hour);
        if (Number.isNaN(hour) || hour < 0 || hour > 23) return;
        counts[hour] += p.soc_lost;
    });

    // Build labels for each UTC hour in the dataDate. If dataDate is missing, fall back to a fixed date.
    const iso = dataDate || "2020-01-01";
    const parts = iso.split("-").map(s => Number(s));
    const y = parts[0] || 2020;
    const m = parts[1] || 1;
    const d = parts[2] || 1;

    const labels = [];
    const pad = n => String(n).padStart(2, "0");
    for (let utcHour = 0; utcHour < 24; utcHour++) {
        const utcMs = Date.UTC(y, m - 1, d, utcHour);
        if (useLocalHour) {
            const local = new Date(utcMs);
            labels.push(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:00`);
        } else {
            labels.push(`${y}-${pad(m)}-${pad(d)} ${pad(utcHour)}:00 UTC`);
        }
    }

    if (hourChart) hourChart.destroy();

    hourChart = new Chart(document.getElementById("hourChart"), {
        type: "bar",
        data: { labels, datasets: [{ data: counts }] },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: useLocalHour ? `Local Hour (${detectedTimeZone})` : "UTC Hour" } },
                y: { title: { display: true, text: "SOC Lost" } }
            }
        }
    });
}

function updateAmperageChart(pings) {
    const counts = { "<18A": 0, ">=18A": 0 };

    // If amperage is a number, fix your binning logic:
    pings.forEach(p => {
        if (p.amperage == "<18A") counts["<18A"] += p.soc_lost;
        else counts[">=18A"] += p.soc_lost;
    });

    if (amperageChart) amperageChart.destroy();

    amperageChart = new Chart(document.getElementById("amperageChart"), {
        type: "bar",
        data: { labels: ["<18A", ">=18A"], datasets: [{ data: [counts["<18A"], counts[">=18A"]] }] },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: "Amperage" } },
                y: { title: { display: true, text: "SOC Lost" } }
            }
        }
    });
}

function updateBmsChart(pings) {
    // Aggregate SOC lost by BMS
    const map = new Map();
    pings.forEach(p => {
        const key = p.bms_id;
        if (!key) return;
        const prev = map.get(key) || 0;
        map.set(key, prev + p.soc_lost);
    });

    const labels = [...map.keys()];
    const values = [...map.values()];

    if (bmsChart) bmsChart.destroy();

    const ctx = document.getElementById("bmsChart").getContext("2d");
    bmsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    data: values,
                    backgroundColor: "#f54242"
                }
            ]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: "BMS ID" } },
                y: { title: { display: true, text: "SOC Lost" } }
            },
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const idx = elements[0].index;
                const bmsId = labels[idx];
                if (!bmsId) return;
                showBatteryDetails(bmsId);
            }
        }
    });
}
function showBatteryDetails(bmsId) {
    if (!jsonData || !bmsId) return;
    currentBatteryId = bmsId;

    // Filter all pings for this battery
    const batteryPings = jsonData.pings.filter(p => p.bms_id === bmsId);

    if (batteryPings.length === 0) {
        document.getElementById("batteryDetails").textContent = "No data for this battery.";
        return;
    }

    // Display basic info
    document.getElementById("batteryDetails").innerHTML = `<b>Battery ID:</b> ${bmsId}<br>Total SOC Lost: ${batteryPings.reduce((s, p) => s + p.soc_lost, 0)}`;

    updateBatteryCentroidChart(batteryPings);
    updateBatteryHourChart(batteryPings);
    updateBatteryAmperageChart(batteryPings);
    displaySwapFlow(bmsId)
}


function updateBatteryCentroidChart(pings) {
    const mapCentroidMap = new Map(); // label → centroid_id
    const socMap = new Map(); // label → total SOC lost

    pings.forEach(p => {
        const cent = centroidLookup[p.centroid_id];
        if (!cent) return;
        const label = cent.name || cent.id;
        mapCentroidMap.set(label, cent.id);
        socMap.set(label, (socMap.get(label) || 0) + p.soc_lost);
    });

    const labels = [...socMap.keys()];
    const values = [...socMap.values()];

    if (batteryCentroidChart) batteryCentroidChart.destroy();

    const ctx = document.getElementById("batteryCentroidChart").getContext("2d");
    batteryCentroidChart = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ data: values, backgroundColor: "#4287f5" }] },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: "Centroid" } },
                y: { title: { display: true, text: "SOC Lost" } }
            },
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const idx = elements[0].index;
                const label = labels[idx];
                const centroidId = mapCentroidMap.get(label);
                if (!centroidId) return;
                const centroid = centroidLookup[centroidId];
                if (!centroid) return;

                // Fly to centroid on map and show details
                map.flyTo([centroid.latitude, centroid.longitude], 20, { animate: false });
                showCentroidDetails(centroid);
            }
        }
    });
}

function updateBatteryHourChart(pings) {
    pings = pings || [];
    const counts = Array(24).fill(0);

    pings.forEach(p => {
        const hour = Number(p.hour);
        if (!Number.isNaN(hour) && hour >= 0 && hour < 24) counts[hour] += p.soc_lost;
    });

    const iso = dataDate || "2020-01-01";
    const parts = iso.split("-").map(s => Number(s));
    const y = parts[0] || 2020;
    const m = parts[1] || 1;
    const d = parts[2] || 1;

    const labels = [];
    const pad = n => String(n).padStart(2, "0");

    for (let utcHour = 0; utcHour < 24; utcHour++) {
        const utcMs = Date.UTC(y, m - 1, d, utcHour);
        if (batteryUseLocalHour) {
            const local = new Date(utcMs);
            labels.push(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:00`);
        } else {
            labels.push(`${y}-${pad(m)}-${pad(d)} ${pad(utcHour)}:00 UTC`);
        }
    }

    if (batteryHourChart) batteryHourChart.destroy();
    batteryHourChart = new Chart(document.getElementById("batteryHourChart"), {
        type: "bar",
        data: { labels, datasets: [{ data: counts }] },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: batteryUseLocalHour ? `Local Hour (${batteryDetectedTimeZone})` : "UTC Hour" } },
                y: { title: { display: true, text: "SOC Lost" } }
            }
        }
    });
}


function updateBatteryAmperageChart(pings) {
    const bins = { "<18A": 0, ">=18A": 0 };
    pings.forEach(p => {
        const a = p.amperage;
        if (typeof a === "number") bins[a < 18 ? "<18A" : ">=18A"] += p.soc_lost;
        else if (typeof a === "string") bins[a.startsWith("<") ? "<18A" : ">=18A"] += p.soc_lost;
    });

    const labels = ["<18A", ">=18A"];
    const data = [bins["<18A"], bins[">=18A"]];

    if (batteryAmperageChart) batteryAmperageChart.destroy();
    batteryAmperageChart = new Chart(document.getElementById("batteryAmperageChart"), {
        type: "bar",
        data: { labels, datasets: [{ data }] },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: "Amperage" } },
                y: { title: { display: true, text: "SOC Lost" } }
            }
        }
    });
}




// -----------------------------
// Visibility helpers
// -----------------------------
function isCentroidInView(c) {
    if (!map || c == null || c.latitude == null || c.longitude == null) return false;
    try {
        return map.getBounds().contains(L.latLng(c.latitude, c.longitude));
    } catch (e) {
        return false;
    }
}

function updateCentroidVisibilityWarning(c) {
    const container = document.getElementById("centroidDetails");
    if (!container) return;

    let warn = document.getElementById("centroidVisibilityWarning");
    // if the warning placeholder isn't present (older markup), create one
    if (!warn) {
        warn = document.createElement('div');
        warn.id = 'centroidVisibilityWarning';
        warn.style.color = '#a00';
        warn.style.marginTop = '8px';
        container.appendChild(warn);
    }

    if (!c) {
        warn.style.display = 'none';
        return;
    }

    const visible = isCentroidInView(c);
    if (visible) {
        warn.style.display = 'none';
        warn.textContent = '';
    } else {
        warn.style.display = 'block';
        warn.textContent = 'WARNING: this centroid is outside the current map view. Use "Jump to map" to center it.';
    }
}

// Highlight helpers for the currently-selected centroid (blue)
function highlightSelectedCentroid(c) {
    if (!selectedCentroidLayer) return;
    // clear previous selection
    selectedCentroidLayer.clearLayers();
    if (!c || c.latitude == null || c.longitude == null) return;

    try {
        const marker = L.circleMarker([c.latitude, c.longitude], {
            radius: 12,
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0.6,
            weight: 2
        }).addTo(selectedCentroidLayer);
        if (marker.bringToFront) marker.bringToFront();
    } catch (e) {
        // silently ignore if map/leaflet not available
    }
}

// Export helper: given a Tabulator group, export unique centroids as CSV
function exportGroupCSV(group, labelHint) {
    const rows = getAllRows(group || {});

    // collect unique centroid names
    const names = new Set();
    rows.forEach(r => {
        const name = r.getData?.()?.centroid_name ?? r.centroid_name;
        if (name != null) names.add(String(name));
    });

    if (names.size === 0) {
        alert("No centroids to export for this group");
        return;
    }

    // CSV header
    const header = ["centroid_name", "total_leakage", "latitude", "longitude", "google_maps_link"];
    const lines = [header.join(",")];

    names.forEach(name => {
        // find the first matching centroid by name
        const id = Object.values(centroidLookup).find(c => c.name === name)?.id;
        if (!id) return; // skip if no centroid found
        const c = centroidLookup[id];
        if (!c) return;
        const lat = c.latitude;
        const lon = c.longitude;
        // add total leakage calculation for this centroid id
        const pings = jsonData.pings.filter(p => centroidLookup[p.centroid_id].name === c.name);
        const totalSoc = pings.reduce((s, p) => s + p.soc_lost, 0);
        const gm = `https://www.google.com/maps?q=${lat},${lon}`;
        // wrap text fields in quotes
        lines.push(`"${name}",${totalSoc},${lat},${lon},"${gm.replace(/"/g, '""')}"`);
    });

    const csv = lines.join("\n");

    // build filename using label hint and dataDate
    const safeLabel = String(labelHint || "group").replace(/[^a-z0-9_\-]/gi, "_");
    const datepart = dataDate || new Date().toISOString().slice(0, 10);
    const filename = `export_${safeLabel}_${datepart}.csv`;

    // trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// ------------------------------------------------------------
// PIVOT UPDATE
// ------------------------------------------------------------
function updatePivot() {
    if (autoSorted) {
        autoSorted = false;
    }
    if (pingTableTabulator) pingTableTabulator.setGroupBy(getSelectedPivotFields());
}


function displaySwapFlow(bms_id) {
    const container = document.getElementById("SwapFlowBox");

    // Filter pings by bms_id
    const filtered = jsonData.pings.filter(p => p.bms_id === bms_id);

    if (filtered.length === 0) {
        container.innerHTML = `<p>No data found for BMS ID: ${bms_id}</p>`;
        return;
    }

    // Aggregate soc_lost by last_swap_time and keep last_swap_state (choose the first one if multiple)
    const aggregated = {};

    filtered.forEach(p => {
        const key = p.last_swap_time;
        if (!aggregated[key]) {
            aggregated[key] = { last_swap_state: p.last_swap_state, soc_lost: 0 };
        }
        aggregated[key].soc_lost += p.soc_lost;
    });

    // Convert aggregated object to sorted array
    const sorted = Object.entries(aggregated)
        .map(([last_swap_time, data]) => ({ last_swap_time, ...data }))
        .sort((a, b) => new Date(a.last_swap_time) - new Date(b.last_swap_time));


    let tableHTML = `<b>Chronological Swap and Leakage Events</b><br><br>`;

    sorted.forEach(row => {
        // Convert last_swap_time to local time if needed
        let to_display = row.last_swap_time;

        if (batteryUseLocalHour && row.last_swap_time !== "Unknown") {
            const utcDate = new Date(row.last_swap_time);

            to_display = utcDate.toLocaleString("en-CA", {
                timeZone: batteryDetectedTimeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            }).replace(',', ''); // remove comma

        }

        tableHTML += `<span id="arrow">&darr;</span><div class="swap-container">`;

        tableHTML += `
            <div class="swap-flow-row">
                <span class="swap-state"><b>${row.last_swap_state}</b></span>
            </div>`;

        tableHTML += `
            <div class="swap-flow-row">
                <span class="swap-time">${to_display}</span>
            </div>`;

        tableHTML += `</div>`;

        if (row.soc_lost > 0) {
            tableHTML += `
            <span id="arrow">&darr;</span>
            <div class="swap-soc-lost">
                <span class="soc-label">SOC Leaked:</span>
                <span class="soc-value">${row.soc_lost}</span>
            </div>`;
        }
    });

    container.innerHTML = tableHTML;
}

