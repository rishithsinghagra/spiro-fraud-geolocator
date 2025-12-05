// ------------------------------------------------------------
// Globals
// ------------------------------------------------------------
let jsonData = null;
let centroidLookup = {};
let pingTableTabulator = null;
let hourChart = null;
let amperageChart = null;

let centroidMarkers = {};
let centroidLayer;
let map;

// ------------------------------------------------------------
// Init: map & UI
// ------------------------------------------------------------
window.onload = () => {
    setupPivotList();
    setupMap();
};

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
    jsonData = JSON.parse(await file.text());

    jsonData.centroids.forEach(c => (centroidLookup[c.id] = c));

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


function pad30(n) {
    return `<span style="white-space:pre;color:black;display:inline-block;min-width:50%">${String(n ?? 0)}</span>`;
}

function getGroupDepth(group) {
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
    pingTableTabulator = new Tabulator("#pingTable", {
        data: tableData,
        layout: "fitColumns",
        height: "100%",
        headerFilter: true,
        groupBy: groupFields,
        groupToggleElement: "arrow",
        groupStartOpen: false,
        groupClosedShowCalcs: true,
        rowFormatter: function (row) {
            row.getElement().style.display = "none";   // hides row visually
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

            return pad30(value) + `   -   SOC Lost: ${sum}`;
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
        const lastLevelGroups = getAllLastLevelGroups(pingTableTabulator);
        lastLevelGroups.forEach(element => {
            const el = element.getElement();
            const toggle = el.querySelector(".tabulator-group-toggle");
            if (toggle) {
                toggle.style.display = "none";     // hide it
                toggle.onclick = null;             // disable click
            }
        });
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
        rows.forEach(row => {
            const id = row.getData().centroid_id;
            if (id != null) ids.add(String(id));
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
    });

}

// ------------------------------------------------------------
// MAP & CHARTS
// ------------------------------------------------------------
function setupMap() {
    map = L.map("map").setView([0, 0], 2);
    centroidLayer = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
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
    const pings = jsonData.pings.filter(p => p.centroid_id === c.id);

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
        <b>Total SOC Lost:</b> ${totalSoc}
    `;

    updateHourChart(pings);
    updateAmperageChart(pings);
}


function updateHourChart(pings) {
    const counts = Array(24).fill(0);
    pings.forEach(p => counts[p.hour] += p.soc_lost);

    if (hourChart) hourChart.destroy();

    hourChart = new Chart(document.getElementById("hourChart"), {
        type: "bar",
        data: { labels: [...Array(24).keys()], datasets: [{ data: counts }] },
        options: { plugins: { legend: { display: false } } }
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
        options: { plugins: { legend: { display: false } } }
    });
}

// ------------------------------------------------------------
// PIVOT UPDATE
// ------------------------------------------------------------
function updatePivot() {
    if (jsonData) pingTableTabulator.setGroupBy(getSelectedPivotFields());
    if (pingTableTabulator) sort_by_soc(pingTableTabulator);
}
