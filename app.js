// Main application
const audioEngine = new EnvironmentalAudioEngine();

let isRunning = false;
let locationWatchId = null;
let updateInterval = null;
let weatherFetchInterval = null;

// OpenWeatherMap API key - get your free key at https://openweathermap.org/api
const WEATHER_API_KEY = 'f021a3fc34dd1d322df919d299a246c6';

// Current environmental data
let currentData = {
    latitude: 0,
    longitude: 0,
    speed: 0,
    temperature: 20,
    humidity: 50,
    heading: 0,
    weatherDescription: '',
    timeOfDay: 0.5,
    populationDensity: 0.5, // 0 = rural, 1 = dense urban
    trafficDensity: 0.0, // 0 = no traffic, 1 = heavy traffic
    elevation: 0, // meters above sea level
    rainfall: 0 // mm/hour (0 = no rain, >0 = active rain)
};

// DOM elements
const toggleBtn = document.getElementById('toggleBtn');
const compassBtn = document.getElementById('compassBtn');
const modeBtn = document.getElementById('modeBtn');
const waveformBtn = document.getElementById('waveformBtn');
const scaleSelector = document.getElementById('scaleSelector');
const scaleSelect = document.getElementById('scaleSelect');
const statusEl = document.getElementById('status');
const latEl = document.getElementById('lat');
const lonEl = document.getElementById('lon');
const speedEl = document.getElementById('speed');
const headingEl = document.getElementById('heading');
const tempEl = document.getElementById('temp');
const weatherEl = document.getElementById('weather');
const timeEl = document.getElementById('time');

// Initialize
toggleBtn.addEventListener('click', toggleAudio);
compassBtn.addEventListener('click', enableCompass);
modeBtn.addEventListener('click', toggleMode);
waveformBtn.addEventListener('click', toggleWaveform);
scaleSelect.addEventListener('change', changeScale);

audioEngine.onFrequencyUpdate = (frequencies) => {
    frequencies.forEach((freq, i) => {
        const freqEl = document.getElementById(`freq${i}`);
        if (freqEl) {
            freqEl.textContent = `${freq.toFixed(1)} Hz`;
        }
    });
};

async function toggleAudio() {
    if (!isRunning) {
        await startAudio();
    } else {
        stopAudio();
    }
}

async function startAudio() {
    try {
        // Start audio engine FIRST (iOS requires this from direct user tap)
        statusEl.textContent = 'Starting audio...';
        statusEl.classList.add('active');
        await audioEngine.start();
        
        // Request location permission AFTER audio is initialized
        if (!navigator.geolocation) {
            alert('Geolocation not supported by your browser');
            audioEngine.stop();
            statusEl.classList.remove('active');
            return;
        }
        
        statusEl.textContent = 'Getting location...';
        
        // Start location tracking
        locationWatchId = navigator.geolocation.watchPosition(
            onLocationUpdate,
            onLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
        
        // Update time of day every second
        updateInterval = setInterval(updateTimeOfDay, 1000);
        
        // Fetch weather every 5 minutes
        fetchWeather();
        weatherFetchInterval = setInterval(fetchWeather, 5 * 60 * 1000);
        
        // Show compass enable button
        if (window.DeviceOrientationEvent) {
            compassBtn.style.display = 'block';
        } else {
            headingEl.textContent = 'Not supported';
        }
        
        // Show mode toggle button
        modeBtn.style.display = 'block';
        
        // Show waveform toggle button
        waveformBtn.style.display = 'block';
        
        // Show scale selector
        scaleSelector.style.display = 'flex';
        
        // Update UI
        toggleBtn.textContent = 'Stop';
        toggleBtn.classList.remove('btn-start');
        toggleBtn.classList.add('btn-stop');
        statusEl.textContent = 'Running';
        
        isRunning = true;
        
    } catch (error) {
        console.error('Error starting audio:', error);
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.classList.remove('active');
    }
}

function stopAudio() {
    // Stop audio
    audioEngine.stop();
    
    // Stop location tracking
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
    
    // Remove orientation listener
    if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', onOrientationChange);
    }
    
    // Stop intervals
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    if (weatherFetchInterval) {
        clearInterval(weatherFetchInterval);
        weatherFetchInterval = null;
    }
    
    // Update UI
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.remove('btn-stop');
    toggleBtn.classList.add('btn-start');
    statusEl.textContent = 'Stopped';
    statusEl.classList.remove('active');
    
    // Hide and reset compass button
    compassBtn.style.display = 'none';
    compassBtn.textContent = 'Enable Compass';
    compassBtn.disabled = false;
    compassBtn.style.background = '#05a';
    
    // Hide mode button
    modeBtn.style.display = 'none';
    modeBtn.textContent = 'Mode: Drone';
    
    // Hide waveform button
    waveformBtn.style.display = 'none';
    waveformBtn.textContent = 'Wave: Sine';
    
    // Hide scale selector
    scaleSelector.style.display = 'none';
    scaleSelect.value = 'dreyblatt';
    
    isRunning = false;
}

function toggleMode() {
    const modes = ['drone', 'pulse', 'click'];
    const currentIndex = modes.indexOf(audioEngine.mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const newMode = modes[nextIndex];
    
    audioEngine.setMode(newMode);
    
    // Update button text and color
    const displayNames = { 'drone': 'Drone', 'pulse': 'Pulse', 'click': 'Click' };
    const colors = { 'drone': '#a50', 'pulse': '#0a5', 'click': '#50a' };
    
    modeBtn.textContent = `Mode: ${displayNames[newMode]}`;
    modeBtn.style.background = colors[newMode];
}

function toggleWaveform() {
    const waveforms = ['sine', 'sawtooth', 'organ', 'square', 'metallic', 'harsh'];
    const currentIndex = waveforms.indexOf(audioEngine.waveform);
    const nextIndex = (currentIndex + 1) % waveforms.length;
    const newWaveform = waveforms[nextIndex];
    
    audioEngine.setWaveform(newWaveform);
    
    // Update button text with display name
    const displayNames = {
        'sine': 'Sine',
        'sawtooth': 'Sawtooth', 
        'organ': 'Organ',
        'square': 'Square',
        'metallic': 'Metallic',
        'harsh': 'Harsh'
    };
    waveformBtn.textContent = `Wave: ${displayNames[newWaveform]}`;
}

function changeScale() {
    const newScale = scaleSelect.value;
    audioEngine.setScale(newScale);
}

function onLocationUpdate(position) {
    currentData.latitude = position.coords.latitude;
    currentData.longitude = position.coords.longitude;
    currentData.speed = position.coords.speed || 0;
    
    // Update UI
    latEl.textContent = `${currentData.latitude.toFixed(4)}°`;
    lonEl.textContent = `${currentData.longitude.toFixed(4)}°`;
    
    // Convert speed from m/s to mph
    const speedMph = currentData.speed * 2.237;
    speedEl.textContent = `${speedMph.toFixed(1)} mph`;
    
    // Update traffic density based on speed changes
    updateTrafficDensity();
    
    // Update audio engine
    updateAudioEngine();
}

function onLocationError(error) {
    console.error('Location error:', error);
    statusEl.textContent = 'Location error: ' + error.message;
    
    // Use default location if permission denied
    if (error.code === error.PERMISSION_DENIED) {
        statusEl.textContent = 'Location permission denied - using defaults';
    }
}

// Throttle compass updates to prevent warbling
let lastCompassUpdate = 0;
const COMPASS_THROTTLE_MS = 500; // Only update every 500ms
let compassEnabled = false;

function onOrientationChange(event) {
    // Only process if compass is enabled
    if (!compassEnabled) return;
    
    // Get compass heading
    // alpha = compass heading (0-360, 0 = North)
    // Need to handle both absolute and relative compass
    let heading = event.webkitCompassHeading || event.alpha || 0;
    
    // Normalize to 0-360
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;
    
    currentData.heading = heading;
    
    // Update UI every time (smooth display)
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dirIndex = Math.round(heading / 45) % 8;
    headingEl.textContent = `${heading.toFixed(0)}° (${directions[dirIndex]})`;
    
    // Throttle audio updates to prevent warbling
    const now = Date.now();
    if (now - lastCompassUpdate >= COMPASS_THROTTLE_MS) {
        lastCompassUpdate = now;
        updateAudioEngine();
    }
}

async function enableCompass() {
    try {
        if (compassEnabled) {
            // Toggle OFF - disable compass
            compassEnabled = false;
            compassBtn.textContent = 'Enable Compass';
            compassBtn.style.background = '#a50';
            headingEl.textContent = 'Disabled';
            
            // Reset heading to 0 (North)
            currentData.heading = 0;
            updateAudioEngine();
            return;
        }
        
        // Toggle ON - enable compass
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ requires permission
            const permission = await DeviceOrientationEvent.requestPermission();
            
            if (permission === 'granted') {
                compassEnabled = true;
                window.addEventListener('deviceorientation', onOrientationChange);
                compassBtn.textContent = 'Compass Enabled ✓';
                compassBtn.style.background = '#0a0';
            } else {
                headingEl.textContent = 'Permission denied';
                compassBtn.textContent = 'Permission Denied';
                compassBtn.style.background = '#a00';
            }
        } else {
            // Non-iOS or older iOS - no permission needed
            compassEnabled = true;
            window.addEventListener('deviceorientation', onOrientationChange);
            compassBtn.textContent = 'Compass Enabled ✓';
            compassBtn.style.background = '#0a0';
        }
    } catch (error) {
        console.error('Compass error:', error);
        headingEl.textContent = 'Error: ' + error.message;
        compassBtn.textContent = 'Error';
        compassBtn.style.background = '#a00';
    }
}

function updateTimeOfDay() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    // Convert to 0.0-1.0 scale (0 = midnight, 0.5 = noon)
    currentData.timeOfDay = (hours + minutes / 60 + seconds / 3600) / 24;
    
    // Update UI
    timeEl.textContent = now.toLocaleTimeString();
    
    // Update audio engine
    updateAudioEngine();
}

async function fetchPopulationDensity() {
    // Use OpenStreetMap Overpass API to count buildings in area
    // More buildings = higher population density
    const radius = 500; // meters
    const lat = currentData.latitude;
    const lon = currentData.longitude;
    
    try {
        const query = `
            [out:json];
            (
                way["building"](around:${radius},${lat},${lon});
                relation["building"](around:${radius},${lat},${lon});
            );
            out count;
        `;
        
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query)
        });
        
        const data = await response.json();
        const buildingCount = data.elements.length;
        
        // Normalize: 0-10 buildings = rural (0.0), 100+ = urban (1.0)
        currentData.populationDensity = Math.min(1.0, buildingCount / 100);
        
        console.log(`Buildings in ${radius}m: ${buildingCount}, density: ${currentData.populationDensity.toFixed(2)}`);
    } catch (error) {
        console.error('OSM density fetch error:', error);
        // Fallback to moderate density
        currentData.populationDensity = 0.5;
    }
}

function updateTrafficDensity() {
    // Simulate traffic density based on speed and time
    // Keeping this for potential future use (could affect other parameters)
    
    const speedMph = currentData.speed * 2.237; // m/s to mph
    const hour = new Date().getHours();
    
    // Rush hour multiplier (7-9am, 4-7pm = high traffic)
    let rushHourFactor = 0;
    if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) {
        rushHourFactor = 0.6;
    }
    
    // Low speed in populated area = likely traffic
    const speedFactor = speedMph < 15 && currentData.populationDensity > 0.5 ? 0.4 : 0;
    
    // Combine factors
    currentData.trafficDensity = Math.min(1.0, 
        rushHourFactor + 
        speedFactor + 
        (currentData.populationDensity * 0.2) // Urban baseline
    );
}

async function fetchWeather() {
    if (WEATHER_API_KEY === 'YOUR_API_KEY_HERE') {
        console.log('Weather API key not set');
        weatherEl.textContent = 'API key needed';
        return;
    }
    
    if (!currentData.latitude || !currentData.longitude) {
        return;
    }
    
    // Fetch population density from OSM (building density as proxy)
    await fetchPopulationDensity();
    
    // Fetch elevation from Open-Elevation API
    await fetchElevation();
    
    // Simulate traffic density based on speed and time of day
    updateTrafficDensity();
    
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${currentData.latitude}&lon=${currentData.longitude}&appid=${WEATHER_API_KEY}&units=metric`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Weather fetch failed');
        }
        
        const data = await response.json();
        currentData.temperature = data.main.temp;
        currentData.humidity = data.main.humidity;
        currentData.weatherDescription = data.weather[0].description;
        
        // Extract rainfall data
        // rain.1h = rainfall in last hour (mm)
        currentData.rainfall = data.rain && data.rain['1h'] ? data.rain['1h'] : 0;
        
        // Update UI
        tempEl.textContent = `${currentData.temperature.toFixed(1)}°C`;
        
        let weatherText = currentData.weatherDescription.charAt(0).toUpperCase() + 
                         currentData.weatherDescription.slice(1) + 
                         ` (${currentData.humidity}% humid)`;
        
        if (currentData.rainfall > 0) {
            weatherText += ` - Rain: ${currentData.rainfall.toFixed(1)}mm/h`;
        }
        
        weatherEl.textContent = weatherText;
        
        // Update audio engine
        updateAudioEngine();
        
    } catch (error) {
        console.error('Weather fetch error:', error);
        weatherEl.textContent = 'Weather unavailable';
    }
}

async function fetchElevation() {
    // Use Open-Elevation API (free, no key needed)
    const lat = currentData.latitude;
    const lon = currentData.longitude;
    
    try {
        const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Elevation fetch failed');
        }
        
        const data = await response.json();
        currentData.elevation = data.results[0].elevation;
        
        console.log(`Elevation: ${currentData.elevation}m above sea level`);
    } catch (error) {
        console.error('Elevation fetch error:', error);
        // Fallback to sea level
        currentData.elevation = 0;
    }
}

function updateAudioEngine() {
    audioEngine.setEnvironmentalData(
        currentData.latitude,
        currentData.longitude,
        currentData.speed,
        currentData.temperature,
        currentData.humidity,
        currentData.heading,
        currentData.timeOfDay,
        currentData.populationDensity,
        currentData.trafficDensity,
        currentData.elevation,
        currentData.rainfall
    );
}

// Wake lock for iOS to keep audio running
let wakeLock = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.log('Wake lock not supported:', err);
    }
}

// Request wake lock when starting
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// Prevent iOS from sleeping during audio playback
document.addEventListener('touchstart', () => {
    if (isRunning && audioEngine.audioContext) {
        audioEngine.audioContext.resume();
    }
}, { passive: true });

// Initialize time display
updateTimeOfDay();