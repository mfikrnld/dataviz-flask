document.addEventListener("DOMContentLoaded", async () => {
  const chartsContainer = document.getElementById("charts-container")
  const detailModal = document.getElementById("detail-modal")
  const closeModalBtn = document.getElementById("close-modal")
  const modalTitle = document.getElementById("modal-title")
  const timeFilterButtons = document.querySelectorAll(".time-filter-button")

  // New elements for interval and splitting
  const formInterval = document.getElementById("form-interval")
  const timeIntervalInput = document.getElementById("time_interval")
  const currentIntervalSpan = document.getElementById("current-interval")
  const intervalButtons = document.querySelectorAll(".interval-button")

  const formSplitting = document.getElementById("form-splitting")
  const numSegmentsInput = document.getElementById("num_segments")
  const currentSegmentsSpan = document.getElementById("current-segments")
  const segmentButtonsContainer = document.getElementById("segment-buttons-container")

  let modalChartInstance = null
  let currentDisplayedData = [] // To store the data currently displayed after server-side filtering/sampling
  let currentChartInstances = {} // To store references to all small chart instances

  // Global state for filters
  let activeTimeRange = "1h"
  let activeTimeInterval = 300 // 0 means no resampling
  let activeNumSegments = 1 // 1 means no splitting
  let activeSegmentIndex = 0 // Default to the first segment

  // Predefined colors for charts (can be extended)
  const chartColors = [
    "rgb(59, 130, 246)", // Blue-500
    "rgb(34, 197, 94)", // Green-500
    "rgb(168, 85, 247)", // Purple-500
    "rgb(249, 115, 22)", // Orange-500
    "rgb(239, 68, 68)", // Red-500
    "rgb(20, 184, 166)", // Teal-500
    "rgb(236, 72, 153)", // Pink-500
    "rgb(6, 182, 212)", // Cyan-500
    "rgb(139, 92, 246)", // Violet-500
  ]

  // Function to fetch data from the Flask backend with all current filters
  async function fetchData(range, interval, numSegments, segmentIndex) {
    try {
      chartsContainer.innerHTML = '<p class="text-gray-600 text-center py-8">Loading data...</p>'
      const response = await fetch(
        `/data?time_range=${range}&time_interval=${interval}&num_segments=${numSegments}&segment_index=${segmentIndex}`,
      )
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      currentDisplayedData = data // Store fetched data (already filtered/sampled by server)
      return data
    } catch (error) {
      console.error("Error fetching data:", error)
      chartsContainer.innerHTML = '<p class="text-red-500 text-center py-8">Error loading data. Please try again.</p>'
      return []
    }
  }

  // Function to create and update a Chart.js instance
  function createChart(canvasId, title, dataKey, data, chartColor, isModal = false) {
    const ctx = document.getElementById(canvasId).getContext("2d")

    // Reverse the data for "last data first" display
    const reversedData = [...data].reverse()

    const labels = reversedData.map((row) => {
      const date = new Date(row.Timestamp)
      const yyyy = date.getFullYear()
      const mm = String(date.getMonth() + 1).padStart(2, "0")
      const dd = String(date.getDate()).padStart(2, "0")
      const hh = String(date.getHours()).padStart(2, "0")
      const mi = String(date.getMinutes()).padStart(2, "0")
      const ss = String(date.getSeconds()).padStart(2, "0")
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
    })
    const values = reversedData.map((row) => row[dataKey])
    const trendValues = reversedData.map((row) => row[`${dataKey}_trend`])

    const chartConfig = {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: dataKey,
            data: values,
            borderColor: chartColor,
            backgroundColor: chartColor.replace("rgb", "rgba").replace(")", ", 0.1)"), // Lighter fill for area
            fill: true,
            tension: 0.1, // Smooth curves
            pointRadius: isModal ? 2 : 0, // Show points in modal, hide in small charts
            pointHoverRadius: isModal ? 4 : 0,
            borderWidth: 2,
          },
          {
            label: `Trend ${dataKey}`,
            data: trendValues,
            borderColor: chartColor,
            borderDash: [5, 5], // Dashed line for trend
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // Allow custom height for canvas
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: isModal, // Show legend only in modal
            position: "top",
          },
          tooltip: {
            enabled: true,
            mode: "index",
            intersect: false,
            callbacks: {
              title: (tooltipItems) => {
                return tooltipItems[0].label // Display timestamp as title
              },
              label: (tooltipItem) =>
                `${tooltipItem.dataset.label}: ${tooltipItem.raw !== undefined ? tooltipItem.raw.toFixed(3) : "N/A"}`,
            },
          },
        },
        scales: {
          x: {
            type: "category", // Use 'category' for time series with string labels
            labels: labels,
            ticks: {
              autoSkip: true,
              maxTicksLimit: isModal ? 10 : 5, // More ticks in modal for detail
              maxRotation: 45,
              minRotation: 45,
            },
            grid: {
              display: false, // Hide x-axis grid lines
            },
          },
          y: {
            beginAtZero: false,
            suggestedMin: Math.min(...values) * 0.98,
            suggestedMax: Math.max(...values) * 1.02,
            grid: {
              color: "rgba(0, 0, 0, 0.05)",
            },
          },
        },
      },
    }

    // Destroy existing chart instance if it exists to prevent memory leaks and re-render issues
    const existingChart = Chart.getChart(canvasId)
    if (existingChart) {
      existingChart.destroy()
    }

    return new Chart(ctx, chartConfig)
  }

  // Function to render all charts based on the provided data
  function renderAllCharts(dataToRender) {
    // Destroy all existing small chart instances
    Object.values(currentChartInstances).forEach((chart) => chart.destroy())
    currentChartInstances = {} // Clear the object

    chartsContainer.innerHTML = "" // Clear existing chart cards

    if (dataToRender.length === 0) {
      chartsContainer.innerHTML = '<p class="text-gray-600">No data available for the selected filters.</p>'
      return
    }

    // Get all data keys (columns) except 'Timestamp', trend columns, and 'ID'
    const dataKeys = Object.keys(dataToRender[0]).filter(
      (key) => key !== "Timestamp" && !key.endsWith("_trend") && key !== "ID",
    )

    let colorIndex = 0 // Reset color index for consistent coloring on re-render
    // Iterate over all data keys to render charts
    dataKeys.forEach((dataKey) => {
      const chartTitle = dataKey // Use the column name as the title
      const chartId = chartTitle.toLowerCase().replace(/\s/g, "-") // Create a slug for ID
      const canvasId = `${chartId}-chart`
      const currentColor = chartColors[colorIndex % chartColors.length] // Cycle through colors
      colorIndex++

      // Create chart card HTML
      const chartCardHtml = `
                <div class="bg-white rounded-lg shadow-md p-6 cursor-pointer transition-shadow hover:shadow-lg"
                     data-chart-id="${chartId}"
                     data-chart-title="${chartTitle}"
                     data-chart-key="${dataKey}"
                     data-chart-color="${currentColor}">
                    <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
                        <span class="w-3 h-3 rounded-full mr-2" style="background-color: ${currentColor};"></span>
                        ${chartTitle}
                    </h2>
                    <div class="relative h-96">
                        <canvas id="${canvasId}"></canvas>
                    </div>
                </div>
            `
      chartsContainer.insertAdjacentHTML("beforeend", chartCardHtml)

      // Initialize the chart and store its instance
      currentChartInstances[chartId] = createChart(canvasId, chartTitle, dataKey, dataToRender, currentColor)
    })
  }

  // Helper function to fetch and render charts with current filter states
  async function fetchAndRenderCharts() {
    const data = await fetchData(activeTimeRange, activeTimeInterval, activeNumSegments, activeSegmentIndex)
    renderAllCharts(data)
  }

  // --- Event Listeners ---

  // Initial load: fetch data and render charts with default filters
  await fetchAndRenderCharts()
  timeIntervalInput.value = activeTimeInterval
  currentIntervalSpan.textContent = activeTimeInterval
  numSegmentsInput.value = activeNumSegments
  currentSegmentsSpan.textContent = activeNumSegments
  generateSegmentButtons(activeNumSegments, activeSegmentIndex)

  // Time Range Filter Buttons (immediate update)
  timeFilterButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      timeFilterButtons.forEach((btn) => btn.classList.remove("active"))
      button.classList.add("active")
      activeTimeRange = button.dataset.timeRange
      await fetchAndRenderCharts()
    })
  })

  // Collection Interval Input and Buttons (update state, submit form to fetch)
  intervalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const interval = Number.parseInt(button.dataset.interval)
      timeIntervalInput.value = interval
      activeTimeInterval = interval
      currentIntervalSpan.textContent = interval
      intervalButtons.forEach((btn) => btn.classList.remove("active"))
      button.classList.add("active")
    })
  })

  timeIntervalInput.addEventListener("change", () => {
    const interval = Number.parseInt(timeIntervalInput.value)
    if (isNaN(interval) || interval < 0 || interval > 3600) {
      alert("Please enter a valid interval between 0 and 3600 seconds.")
      timeIntervalInput.value = activeTimeInterval // Revert to last valid
      return
    }
    activeTimeInterval = interval
    currentIntervalSpan.textContent = interval
    intervalButtons.forEach((btn) => {
      if (Number.parseInt(btn.dataset.interval) === interval) {
        btn.classList.add("active")
      } else {
        btn.classList.remove("active")
      }
    })
  })

  formInterval.addEventListener("submit", async (event) => {
    event.preventDefault() // Prevent default form submission
    await fetchAndRenderCharts()
  })

  // Data Splitting Input and Buttons (update state, submit form to fetch)
  function generateSegmentButtons(numSegments, activeIndex) {
    segmentButtonsContainer.innerHTML = "" // Clear existing buttons
    if (numSegments <= 1) {
      segmentButtonsContainer.innerHTML = '<span class="text-gray-500 text-sm">No segments to display.</span>'
      return
    }
    for (let i = 0; i < numSegments; i++) {
      const button = document.createElement("button")
      button.type = "button"
      button.classList.add(
        "segment-button",
        "px-3",
        "py-1",
        "bg-gray-100",
        "hover:bg-gray-200",
        "text-gray-700",
        "rounded",
        "text-sm",
      )
      button.dataset.segmentIndex = i
      button.textContent = `Segment ${i + 1}`
      if (i === activeIndex) {
        button.classList.add("active")
      }
      button.addEventListener("click", () => {
        activeSegmentIndex = i
        document.querySelectorAll(".segment-button").forEach((btn) => btn.classList.remove("active"))
        button.classList.add("active")
      })
      segmentButtonsContainer.appendChild(button)
    }
  }

  numSegmentsInput.addEventListener("change", () => {
    const numSegments = Number.parseInt(numSegmentsInput.value)
    if (isNaN(numSegments) || numSegments < 1 || numSegments > 100) {
      alert("Please enter a valid number of segments between 1 and 100.")
      numSegmentsInput.value = activeNumSegments // Revert to last valid
      return
    }
    activeNumSegments = numSegments
    currentSegmentsSpan.textContent = numSegments
    // Reset segment index if new num_segments makes current_segment_index invalid
    if (activeSegmentIndex >= activeNumSegments) {
      activeSegmentIndex = 0
    }
    generateSegmentButtons(activeNumSegments, activeSegmentIndex)
  })

  formSplitting.addEventListener("submit", async (event) => {
    event.preventDefault() // Prevent default form submission
    await fetchAndRenderCharts()
  })

  // Add click listeners to dynamically created chart cards (delegated to chartsContainer)
  chartsContainer.addEventListener("click", (event) => {
    const chartCard = event.target.closest("[data-chart-id]")
    if (chartCard) {
      const chartId = chartCard.dataset.chartId
      const chartTitle = chartCard.dataset.chartTitle
      const chartKey = chartCard.dataset.chartKey
      const chartColor = chartCard.dataset.chartColor

      modalTitle.textContent = `${chartTitle} - Detail View`
      detailModal.classList.remove("hidden") // Show the modal

      // Destroy previous modal chart instance before creating a new one
      if (modalChartInstance) {
        modalChartInstance.destroy()
      }
      // Create the detailed chart in the modal using the currently displayed data (which is already filtered by server)
      modalChartInstance = createChart("modal-chart", chartTitle, chartKey, currentDisplayedData, chartColor, true)
    }
  })

  // Close modal event listener for the close button
  closeModalBtn.addEventListener("click", () => {
    detailModal.classList.add("hidden") // Hide the modal
    if (modalChartInstance) {
      modalChartInstance.destroy() // Destroy the chart instance
      modalChartInstance = null
    }
  })

  // Close modal when clicking outside the modal content
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) {
      // Check if the click was on the overlay itself
      detailModal.classList.add("hidden") // Hide the modal
      if (modalChartInstance) {
        modalChartInstance.destroy() // Destroy the chart instance
        modalChartInstance = null
      }
    }
  })
})
