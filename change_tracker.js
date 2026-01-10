
let pingStore = {}
let pingTableTabulator = null;
let station_tolerance = null;
let centroidStore = {};
let availableDatesContainer = null;
let visited_dates = [];
let processingScreen = null;
let split_by = "none";
let graphData = null;
let defaultKey = null;
let locked_series = null;
let current_series = null;

window.onload = () => {
    setupToleranceSlider();
    setupPivotList();
    availableDatesContainer = document.getElementById("availableDatesContainer");
    processingScreen = document.getElementById("loadingOverlay");
    setupSplitOptions();
};

function setupSplitOptions() {
    const elements = document.querySelectorAll(".splitOption");
    elements.forEach(el => {
        el.addEventListener("click", (event) => {
            manageClickOption(event.currentTarget); // pass the clicked element
        });
    });
}

function manageClickOption(mainel) {
    const elements = document.querySelectorAll(".splitOption");
    elements.forEach(el => {
        el.style.background = "lightgray";
    });
    mainel.style.background = "white";
    split_by = mainel.dataset.value;
    renderGraph();
}

function setupToleranceSlider() {
    const toleranceSlider = document.getElementById("toleranceSlider")
    station_tolerance = toleranceSlider.value / 100000
    toleranceSlider.addEventListener("change", () => {
        station_tolerance = toleranceSlider.value / 100000
        propagateToleranceChanges();
        renderAll();
    });
}

function propagateToleranceChanges() {

    processingScreen.hidden = false
    if (centroidStore) {

        visited_dates.forEach(date => {
            const date_obj = centroidStore[date]
            for (const centroid_id in date_obj) {
                const centroid_dict = date_obj[centroid_id]
                if (centroid_dict.closest_stations[0][1] < station_tolerance) {
                    centroid_dict.dynamic_name = centroid_dict.closest_stations[0][0]
                    centroid_dict.type = "station"
                }
                else {
                    centroid_dict.dynamic_name = centroid_dict.name
                    centroid_dict.type = "non-station"
                }
            }
        })
    }

    processingScreen.hidden = true

    clearGraph();
    renderTable();
}

function propagateToleranceChangesSpecific(isoDate) {

    processingScreen.hidden = false

    if (centroidStore) {
        const date_obj = centroidStore[isoDate]
        for (const centroid_id in date_obj) {
            const centroid_dict = date_obj[centroid_id]
            if (centroid_dict.closest_stations[0][1] < station_tolerance) {
                centroid_dict.dynamic_name = centroid_dict.closest_stations[0][0]
                centroid_dict.type = "station"
            }
            else {
                centroid_dict.dynamic_name = centroid_dict.name
                centroid_dict.type = "non-station"
            }
        }
    }

    processingScreen.hidden = true
}

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

document.getElementById("fileInput").addEventListener("change", async (evt) => {
    const files = evt.target.files;

    let addedIsoDates = []

    processingScreen.hidden = false

    for (const file of files) {
        const jsonData = JSON.parse(await file.text());

        const isoDate = jsonData.date;

        centroidStore[isoDate] ??= {};

        jsonData.centroids.forEach(c => {
            centroidStore[isoDate][c.id] = c;
        });

        // After loading jsonData.pings
        pingStore[isoDate] = jsonData.pings.map(obj => ({ ...obj, date: isoDate }));

        // Grouping by all fields except hour, amperage, soc_lost
        const groupedPings = {};

        pingStore[isoDate].forEach(obj => {
            // Create a key by serializing all properties except hour, amperage, soc_lost
            const { hour, amperage, soc_lost, ...groupFields } = obj;
            const key = JSON.stringify(groupFields);

            if (!groupedPings[key]) {
                groupedPings[key] = { ...groupFields, soc_lost: 0 };
            }

            groupedPings[key].soc_lost += soc_lost;
        });

        // Convert back to an array if needed
        pingStore[isoDate] = Object.values(groupedPings);

        if (!visited_dates.includes(isoDate)) {
            visited_dates.push(isoDate);
        }

        addedIsoDates.push(isoDate)
    }

    let available_dates_html = ``

    visited_dates.sort();

    visited_dates.forEach(isoDate => { available_dates_html += `<div class="availableDateContainer"><input type="checkbox" name="includedDates" value="` + isoDate + `">` + isoDate + `</div>`; });

    availableDatesContainer.innerHTML = available_dates_html;

    const checkboxes = document.querySelectorAll('input[name="includedDates"]');

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener("change", (event) => {
            renderAll();
        })
    });

    processingScreen.hidden = true

    addedIsoDates.forEach(isoDate => { propagateToleranceChangesSpecific(isoDate); });

    renderTable();
});

function renderAll() {
    renderTable();
}

function renderGraph() {
    if (window.myChartInstance) window.myChartInstance.destroy();
    if (graphData) {
        const computedSeries = {};
        graphData.forEach(ping => {
            let pk;
            if (split_by === "none") {
                pk = defaultKey;
            } else {
                pk = ping[split_by];
            }
            if (!computedSeries[pk]) {
                computedSeries[pk] = []
                getCheckedIncludedDates().forEach(isoDate => {
                    computedSeries[pk].push({ x: isoDate, y: 0 });
                })
            }
            computedSeries[pk].push({ x: ping.date, y: ping.soc_lost });
        });

        for (const pk in computedSeries) {
            const aggregated = Object.values(
                computedSeries[pk].reduce((acc, p) => {
                    if (!acc[p.x]) acc[p.x] = { x: p.x, y: 0 };
                    acc[p.x].y += p.y;
                    return acc;
                }, {})
            );

            aggregated.sort((a, b) => a.x.localeCompare(b.x));
            computedSeries[pk] = aggregated
        }

        if (locked_series) {
            for (const locked_series_name in locked_series) {
                computedSeries[locked_series_name] = locked_series[locked_series_name]
            }
        }

        current_series = computedSeries;

        const datasets = Object.keys(computedSeries).map(pk => ({
            label: pk,
            data: computedSeries[pk],
            fill: false,
            borderColor: getRandomColor(),
            tension: 0.2
        }));

        // 4️⃣ Render the chart
        const ctx = document.getElementById('mainChart').getContext('2d');

        // Destroy existing chart if present
        if (window.myChartInstance) window.myChartInstance.destroy();

        window.myChartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true },
                    tooltip: { mode: 'nearest' }
                },
                scales: {
                    x: {
                        type: 'category', // for date-only strings
                        title: { display: true, text: 'Date' }
                    },
                    y: {
                        min: 0,
                        title: { display: true, text: 'SOC Lost' }
                    }
                }
            }
        });
    }
}

function getRandomColor() {
    const r = Math.floor(Math.random() * 200 + 30);
    const g = Math.floor(Math.random() * 200 + 30);
    const b = Math.floor(Math.random() * 200 + 30);
    return `rgb(${r},${g},${b})`;
}


function getSelectedPivotFields() {
    return [...document.getElementById("pivotSelect").options]
        .filter(o => o.selected)
        .map(o => o.value);
}

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
        { column: "group_sort_key_6", dir: "desc" },
        { column: "group_sort_key_5", dir: "desc" },
        { column: "group_sort_key_4", dir: "desc" },
        { column: "group_sort_key_3", dir: "desc" },
        { column: "group_sort_key_2", dir: "desc" },
        { column: "group_sort_key_1", dir: "desc" },
    ])
}

function getCheckedIncludedDates() {
    // select all checkboxes with name "includedDates"
    const checkboxes = document.querySelectorAll('input[name="includedDates"]');

    // filter for checked ones and return their values
    const checkedValues = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

    return checkedValues;
}

var autoSorted = false;

function renderTable() {

    let pings = []

    getCheckedIncludedDates().forEach(isoDate => {
        pings.push(...pingStore[isoDate])
    })

    const tableData = pings.map(p => {
        const cent = centroidStore[p.date][p.centroid_id] || {};
        return {
            bms: p.bms_id,
            country: p.country,
            centroid_id: p.centroid_id,
            centroid_name: cent.dynamic_name,
            centroid_type: cent.type,
            last_mapped: p.last_mapped,
            soc_lost: p.soc_lost,
            date: p.date,
            group_sort_key_1: "0000000000",
            group_sort_key_2: "0000000000",
            group_sort_key_3: "0000000000",
            group_sort_key_4: "0000000000",
            group_sort_key_5: "0000000000",
            group_sort_key_6: "0000000000"
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
            { column: "group_sort_key_6", dir: "desc" },
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

            return container;
        },

        columns: [
            { title: "BMS", field: "bms", headerFilter: "input", visible: true },
            { title: "Country", field: "country", headerFilter: "input", visible: true },
            { title: "Centroid ID", field: "centroid_id", headerFilter: "input", visible: false },
            { title: "Centroid Name", field: "centroid_name", headerFilter: "input", visible: true },
            { title: "Type", field: "centroid_type", headerFilter: "input", visible: true },
            { title: "Last Mapped", field: "last_mapped", headerFilter: true, visible: true },
            { title: "SOC Lost", field: "soc_lost", visible: false },
            { title: "GroupSort1", field: "group_sort_key_1", visible: false },
            { title: "GroupSort2", field: "group_sort_key_2", visible: false },
            { title: "GroupSort3", field: "group_sort_key_3", visible: false },
            { title: "GroupSort4", field: "group_sort_key_4", visible: false },
            { title: "GroupSort5", field: "group_sort_key_5", visible: false },
            { title: "GroupSort6", field: "group_sort_key_6", visible: false },
        ],
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

    pingTableTabulator.on("groupClick", function (e, group) {
        const rows = getAllRows(group);

        const rowData = rows.map(row => row.getData());

        graphData = rowData;

        defaultKey = group.getKey()

        renderGraph();
    });

    pingTableTabulator.on("groupVisibilityChanged", function (group) {
        pingTableTabulator.setSort(pingTableTabulator.getSorters());
    });

}

function updatePivot() {
    if (autoSorted) {
        autoSorted = false;
    }
    if (pingTableTabulator) pingTableTabulator.setGroupBy(getSelectedPivotFields());
}

function clearGraph() {
    graphData = null;
    defaultKey = null;
    current_series = null;
    renderGraph();
}


function lock_current_series() {
    if (current_series) {
        locked_series = current_series;
    }
}

function clear_locked_series() {
    locked_series = null;
}


function invertSelectedDates() {
    const checkboxes = document.querySelectorAll('input[name="includedDates"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = !checkbox.checked;
    });
    renderAll();
}
