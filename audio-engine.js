class EnvironmentalAudioEngine {
    constructor() {
        this.audioContext = null;
        this.oscillators = [];
        this.gainNodes = [];
        this.panners = []; // Stereo panners for each oscillator
        this.convolver = null;
        this.masterGain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.lowPassFilter = null;
        this.highPassFilter = null;
        this.isRunning = false;
        
        // Playback mode: 'drone' or 'pulse' or 'bell'
        this.mode = 'drone';
        
        // Waveform type: 'sine', 'triangle', 'sawtooth'
        this.waveform = 'sine';
        
        // Scale type: 'dreyblatt', 'harmonic', 'slendro', 'pelog', 'quartertone'
        this.scale = 'dreyblatt';
        
        // Fundamental frequency based on sun position
        this.fundamentalFreq = 200;
        
        // All 8 oscillators are now sporadic
        this.sporadicTimers = [];
        
        // Environmental parameters
        this.latitude = 0;
        this.longitude = 0;
        this.speed = 0; // meters per second
        this.temperature = 20;
        this.humidity = 50; // percentage
        this.heading = 0; // compass heading in degrees (0 = North)
        this.timeOfDay = 0.5;
        
        // Sun position
        this.sunElevation = 0; // degrees above horizon
        
        // Population and traffic density (0.0 to 1.0)
        this.populationDensity = 0.5; // 0 = rural, 1 = dense urban
        this.trafficDensity = 0.0; // 0 = no traffic, 1 = heavy traffic
        
        // Compass heading tracking for staggered updates
        this.lastHeading = 0;
        this.pendingFrequencyUpdates = []; // Queue of oscillators waiting to update
        
        // Traffic glissando oscillator (dissonant element)
        this.trafficOscillator = null;
        this.trafficGain = null;
        
        this.onFrequencyUpdate = null;
    }
    
    async start() {
        if (this.isRunning) return;
        
        // Create audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Resume context if suspended (iOS)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        setTimeout(() => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }, 100);
        
        // Create reverb
        this.convolver = this.audioContext.createConvolver();
        this.convolver.buffer = this.createReverbImpulse();
        
        // Create dry/wet mix for reverb (controlled by humidity)
        this.dryGain = this.audioContext.createGain();
        this.wetGain = this.audioContext.createGain();
        this.dryGain.gain.value = 0.85; // Increased dry from 70% to 85%
        this.wetGain.gain.value = 0.15; // Reduced wet from 30% to 15% (more subtle)
        
        // Create filters for fundamental (controlled by lat/lon)
        this.lowPassFilter = this.audioContext.createBiquadFilter();
        this.lowPassFilter.type = 'lowpass';
        this.lowPassFilter.frequency.value = 5000;
        
        this.highPassFilter = this.audioContext.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 100;
        
        // Master gain
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1.0; // Max volume (was 0.8)
        
        // Audio chain: oscillators -> gains -> (filters for fund, direct for harmonics) -> dry/wet -> master -> destination
        this.dryGain.connect(this.masterGain);
        this.wetGain.connect(this.convolver);
        this.convolver.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
        
        // Create 8 oscillators (1 fundamental + 7 harmonics)
        for (let i = 0; i < 8; i++) {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const panner = this.audioContext.createStereoPanner();
            
            // Initialize panner (will be controlled by compass)
            panner.pan.value = 0; // Center
            
            oscillator.type = this.waveform; // Use selected waveform
            oscillator.frequency.value = 200;
            
            // Start at 0 volume (sporadic)
            gainNode.gain.value = 0;
            
            // Audio chain: oscillator -> gain -> panner -> filters/reverb
            oscillator.connect(gainNode);
            gainNode.connect(panner);
            
            // Fundamental (osc 0) goes through filters, harmonics bypass filters
            if (i === 0) {
                panner.connect(this.highPassFilter);
                this.highPassFilter.connect(this.lowPassFilter);
                this.lowPassFilter.connect(this.dryGain);
                this.lowPassFilter.connect(this.wetGain);
            } else {
                panner.connect(this.dryGain);
                panner.connect(this.wetGain);
            }
            
            oscillator.start();
            
            this.oscillators.push(oscillator);
            this.gainNodes.push(gainNode);
            this.panners.push(panner);
        }
        
        // Traffic glissando oscillator - DISABLED for testing
        // (Was creating harsh tone even when supposed to be silent)
        this.trafficOscillator = null;
        this.trafficGain = null;
        
        /*
        // Create dedicated traffic glissando oscillator (dissonant element)
        this.trafficOscillator = this.audioContext.createOscillator();
        this.trafficGain = this.audioContext.createGain();
        
        this.trafficOscillator.type = 'sawtooth'; // Harsh, dissonant waveform
        this.trafficOscillator.frequency.value = 100; // Starting frequency
        this.trafficGain.gain.value = 0; // Start silent
        
        // Route through reverb for atmosphere
        this.trafficOscillator.connect(this.trafficGain);
        this.trafficGain.connect(this.dryGain);
        this.trafficGain.connect(this.wetGain);
        
        this.trafficOscillator.start();
        */
        
        this.isRunning = true;
        this.updateFrequencies();
        
        // Start sporadic behavior for ALL oscillators
        this.startSporadicOscillators();
    }
    
    createReverbImpulse() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 1.5; // Increased from 0.875s to 1.5s (more reverb)
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2.5);
                channelData[i] = (Math.random() * 2 - 1) * decay;
            }
        }
        
        return impulse;
    }
    
    startSporadicOscillators() {
        // Oscillators 0-3: Fixed timing (not speed-dependent)
        // Oscillators 4-7: Pulse rate controlled by speed
        
        for (let i = 0; i < 8; i++) {
            this.scheduleSporadicPulse(i);
        }
    }
    
    setMode(mode) {
        // Switch between 'drone' and 'percussive' modes
        this.mode = mode;
        
        // Restart all timers with new timing
        this.sporadicTimers.forEach(timer => clearTimeout(timer));
        this.sporadicTimers = [];
        
        for (let i = 0; i < 8; i++) {
            this.scheduleSporadicPulse(i);
        }
    }
    
    setWaveform(waveform) {
        // Switch between waveforms: sine, triangle, sawtooth, roundpm, cello, organ, oboe, tympani
        this.waveform = waveform;
        
        // Update all oscillator types
        this.oscillators.forEach(osc => {
            if (waveform === 'roundpm') {
                // Create custom PeriodicWave for rounded pulse-width modulation
                // Combines fundamental with harmonics to create rounded square-ish wave
                const real = new Float32Array([0, 0.8, 0, 0.3, 0, 0.15, 0, 0.08, 0, 0.05]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'cello') {
                // CELLO-LIKE: Rich odd harmonics with emphasized 3rd/5th for bowed string character
                // Cello has strong fundamental + prominent odd harmonics
                const real = new Float32Array([
                    0,      // DC offset
                    1.0,    // Fundamental (strong)
                    0.4,    // 2nd harmonic (moderate)
                    0.7,    // 3rd harmonic (emphasized - cello characteristic)
                    0.2,    // 4th
                    0.5,    // 5th harmonic (emphasized)
                    0.15,   // 6th
                    0.3,    // 7th (odd harmonic)
                    0.1,    // 8th
                    0.2,    // 9th (odd)
                    0.08,   // 10th
                    0.15,   // 11th
                    0.05,   // 12th
                    0.1     // 13th
                ]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'organ') {
                // PIPE ORGAN: Even harmonic series with 8', 4', 2' stops simulation
                // Pipe organs emphasize specific harmonic ratios (organ stops)
                const real = new Float32Array([
                    0,      // DC offset
                    1.0,    // 8' fundamental
                    0.7,    // 2nd (4' stop - octave)
                    0.3,    // 3rd (mutation)
                    0.8,    // 4th (2' stop - two octaves)
                    0.2,    // 5th
                    0.4,    // 6th
                    0.15,   // 7th
                    0.6,    // 8th (1' stop - three octaves)
                    0.1,    // 9th
                    0.3,    // 10th
                    0.08,   // 11th
                    0.2,    // 12th
                    0.05,   // 13th
                    0.15,   // 14th
                    0.03,   // 15th
                    0.4     // 16th (mixtures)
                ]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'oboe') {
                // OBOE: Nasal, reedy double-reed character
                // Strong odd harmonics (3rd, 5th, 7th) create nasal/reedy timbre
                // Weak even harmonics, prominent upper partials
                const real = new Float32Array([
                    0,      // DC offset
                    1.0,    // Fundamental
                    0.2,    // 2nd (weak even)
                    0.9,    // 3rd (STRONG odd - nasal characteristic)
                    0.15,   // 4th (weak even)
                    0.8,    // 5th (STRONG odd - reedy)
                    0.1,    // 6th
                    0.7,    // 7th (STRONG odd)
                    0.08,   // 8th
                    0.5,    // 9th (strong odd)
                    0.05,   // 10th
                    0.4,    // 11th (odd)
                    0.03,   // 12th
                    0.3,    // 13th (odd)
                    0.02,   // 14th
                    0.2,    // 15th
                    0.01,   // 16th
                    0.15,   // 17th (upper partials)
                    0.01,   // 18th
                    0.1     // 19th
                ]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'tympani') {
                // TYMPANI: Deep resonant kettledrum
                // Inharmonic partials typical of drums, strong fundamental
                // Emphasis on fundamental with quickly decaying upper partials
                const real = new Float32Array([
                    0,      // DC offset
                    1.0,    // Fundamental (VERY strong - drum head)
                    0.3,    // 2nd (moderate)
                    0.15,   // 3rd (weak - inharmonic)
                    0.25,   // 4th (moderate resonance)
                    0.08,   // 5th (weak)
                    0.12,   // 6th (slight resonance)
                    0.05,   // 7th (very weak)
                    0.08,   // 8th (weak resonance)
                    0.03,   // 9th
                    0.05,   // 10th
                    0.02,   // 11th
                    0.03,   // 12th
                    0.01,   // 13th
                    0.02,   // 14th
                    0.01    // 15th (minimal upper partials)
                ]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else {
                // Standard waveforms
                osc.type = waveform;
            }
        });
    }
    
    setScale(scale) {
        // Switch between different tuning systems
        this.scale = scale;
        
        // Update frequencies with new scale
        this.updateFrequencies();
    }
    
    scheduleSporadicPulse(oscIndex) {
        // Speed-dependent timing for oscillators 4-7
        const isSpeedControlled = oscIndex >= 4;
        const isSpeedOscillator = oscIndex === 3;
        
        let interval, duration, fadeIn, fadeOut;
        
        if (this.mode === 'pulse') {
            // PULSE MODE: Short, sharp bursts
            duration = 50 + Math.random() * 250; // 50-300ms
            fadeIn = (20 + Math.random() * 60) / 1000; // 20-80ms attack
            fadeOut = (10 + Math.random() * 40) / 1000; // 10-50ms release
            
            // ALL oscillators respond to speed for density
            const speedNorm = Math.min(this.speed / 35.8, 1);
            if (isSpeedOscillator) {
                const minInterval = 4000 - (speedNorm * 3500); // 4s to 0.5s
                const maxInterval = 8000 - (speedNorm * 7000); // 8s to 1s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                // All other oscillators also speed-controlled for density
                const minInterval = 2000 - (speedNorm * 1500); // 2s to 0.5s
                const maxInterval = 4000 - (speedNorm * 3000); // 4s to 1s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            }
        } else if (this.mode === 'bell') {
            // BELL MODE: Very short, sharp attacks with long decay (tuned bells)
            duration = 800 + Math.random() * 1200; // 0.8-2 seconds total
            fadeIn = (1 + Math.random() * 4) / 1000; // 1-5ms instant attack (bell strike)
            fadeOut = 0.7 + Math.random() * 1.2; // 0.7-1.9s long decay (bell ring)
            
            // ALL oscillators respond to speed for density
            const speedNorm = Math.min(this.speed / 35.8, 1);
            if (isSpeedOscillator) {
                const minInterval = 3000 - (speedNorm * 2500); // 3s to 0.5s
                const maxInterval = 6000 - (speedNorm * 5000); // 6s to 1s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                // All other oscillators also speed-controlled for density
                const minInterval = 2000 - (speedNorm * 1500); // 2s to 0.5s
                const maxInterval = 4000 - (speedNorm * 3000); // 4s to 1s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            }
        } else {
            // DRONE MODE: Longer, sustained tones with significant overlap
            duration = 3000 + Math.random() * 6000; // 3-9 seconds (was 1-6s)
            fadeIn = 0.5 + Math.random() * 1.0; // 0.5-1.5s (was 0.2-0.7s)
            fadeOut = 1.0 + Math.random() * 2.0; // 1.0-3.0s (was 0.3-1.3s)
            
            // ALL oscillators respond to speed for density
            const speedNorm = Math.min(this.speed / 35.8, 1);
            if (isSpeedOscillator) {
                const minInterval = 8000 - (speedNorm * 6000); // 8s to 2s (was 5s to 1s)
                const maxInterval = 12000 - (speedNorm * 8000); // 12s to 4s (was 8s to 2s)
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                // All other oscillators also speed-controlled for density
                const minInterval = 6000 - (speedNorm * 4000); // 6s to 2s (was 3s to 1s)
                const maxInterval = 10000 - (speedNorm * 6000); // 10s to 4s (was 6s to 2s)
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            }
        }
        
        const timer = setTimeout(() => {
            if (!this.isRunning) return;
            
            // Fade times already in seconds
            const fadeInSec = fadeIn;
            const fadeOutSec = fadeOut;
            
            // Volume based on mode
            let targetVolume;
            if (this.mode === 'pulse') {
                targetVolume = 0.08; // Was 0.035, now 2.3x louder
            } else if (this.mode === 'bell') {
                targetVolume = 0.15; // Was 0.10, now 1.5x louder
                
                // Reduce volume for upper register oscillators (less shrill)
                if (oscIndex >= 5) {
                    targetVolume *= 0.6; // Less reduction
                } else if (oscIndex === 4) {
                    targetVolume *= 0.8; // Less reduction
                }
            } else {
                targetVolume = 0.10; // Drone - was 0.04, now 2.5x louder
            }
            
            // In drone mode, boost lower oscillators for bass presence
            if (this.mode === 'drone' && oscIndex <= 2) {
                targetVolume *= 1.15;
            }
            
            // In drone mode, reduce mid-range but keep ultra-highs audible
            if (this.mode === 'drone') {
                if (oscIndex === 4) {
                    targetVolume *= 0.5; // Cut mid-range significantly
                } else if (oscIndex === 5) {
                    targetVolume *= 0.5; // Reduce high-mid
                } else if (oscIndex === 6 || oscIndex === 7) {
                    targetVolume *= 0.6; // Keep ultra-highs more present
                }
            }
            
            // BELL MODE: Add sharp click at start for percussive attack
            if (this.mode === 'bell') {
                // Create white noise buffer for click
                const clickDuration = 0.005; // 5ms click
                const sampleRate = this.audioContext.sampleRate;
                const clickBuffer = this.audioContext.createBuffer(1, sampleRate * clickDuration, sampleRate);
                const clickData = clickBuffer.getChannelData(0);
                
                // Generate short burst of noise for click
                for (let i = 0; i < clickData.length; i++) {
                    const decay = 1 - (i / clickData.length); // Quick decay
                    clickData[i] = (Math.random() * 2 - 1) * decay * 0.3; // Quiet click
                }
                
                // Play click through separate buffer source
                const clickSource = this.audioContext.createBufferSource();
                const clickGain = this.audioContext.createGain();
                clickSource.buffer = clickBuffer;
                clickGain.gain.value = targetVolume * 0.5; // Click at 50% of tone volume
                
                clickSource.connect(clickGain);
                clickGain.connect(this.dryGain);
                clickGain.connect(this.wetGain);
                
                clickSource.start(now);
            }
            
            this.fadeIn(oscIndex, fadeInSec, targetVolume);
            
            setTimeout(() => {
                if (!this.isRunning) return;
                this.fadeOut(oscIndex, fadeOutSec);
                
                // Schedule next pulse
                this.scheduleSporadicPulse(oscIndex);
            }, duration);
        }, interval);
        
        this.sporadicTimers.push(timer);
    }
    
    fadeIn(oscIndex, duration, targetVolume) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        
        // Add slight irregularity to attack timing for organic feel
        const irregularity = (Math.random() - 0.5) * 0.02; // ±10ms variation
        const organicDuration = Math.max(0.01, duration + irregularity);
        
        // Minimal amplitude flutter (extremely subtle)
        const flutter = (Math.random() - 0.5) * 0.001; // ±0.1% volume variation
        const organicVolume = targetVolume * (1 + flutter);
        
        // POPULATION DENSITY AFFECTS ENVELOPE SHAPE
        // Urban (high density): normal attack, normal decay
        // Rural (low density): REVERSE - gradual attack, instant cutoff
        
        // Scale attack time by population density inversely (REDUCED multiplier)
        // Rural = slower attack (reverse effect), Urban = normal fast attack
        const reverseAttackMultiplier = 1 + (1 - this.populationDensity) * 2; // 1x (urban) to 3x (rural) - was 5x
        const finalDuration = organicDuration * reverseAttackMultiplier;
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(organicVolume, now + finalDuration);
    }
    
    fadeOut(oscIndex, duration) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        
        // POPULATION DENSITY AFFECTS ENVELOPE SHAPE
        // Urban (high density): normal gradual fadeout
        // Rural (low density): INSTANT CUTOFF (no decay, hard stop)
        
        // Rural areas get near-instant cutoff
        const ruralCutoff = this.populationDensity < 0.3; // Very rural
        
        if (ruralCutoff) {
            // INSTANT CUTOFF for rural areas (reverse effect)
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.001); // 1ms hard stop
        } else {
            // Normal fadeout for urban areas, scaled by density
            const irregularity = (Math.random() - 0.5) * 0.02;
            const organicDuration = Math.max(0.01, duration + irregularity);
            
            // Urban = longer fadeout, Rural = shorter
            const fadeMultiplier = this.populationDensity; // 0.3-1.0
            const finalDuration = organicDuration * fadeMultiplier;
            
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + finalDuration);
        }
    }
    
    stop() {
        if (!this.isRunning) return;
        
        // Clear sporadic timers
        this.sporadicTimers.forEach(timer => clearTimeout(timer));
        this.sporadicTimers = [];
        
        // Stop traffic glissando oscillator
        if (this.trafficOscillator) {
            try {
                this.trafficOscillator.stop();
            } catch (e) {}
            this.trafficOscillator = null;
            this.trafficGain = null;
        }
        
        // Stop oscillators
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {}
        });
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.oscillators = [];
        this.gainNodes = [];
        this.panners = [];
        this.convolver = null;
        this.masterGain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.lowPassFilter = null;
        this.highPassFilter = null;
        this.audioContext = null;
        this.isRunning = false;
    }
    
    setEnvironmentalData(lat, lon, speed, temp, humidity, heading, timeOfDay, populationDensity = 0.5, trafficDensity = 0.0) {
        this.latitude = lat;
        this.longitude = lon;
        this.speed = speed;
        this.temperature = temp;
        this.humidity = humidity;
        this.heading = heading;
        this.timeOfDay = timeOfDay;
        this.populationDensity = populationDensity;
        this.trafficDensity = trafficDensity;
        
        this.updateFrequencies();
    }
    
    calculateSunElevation() {
        // Simplified sun elevation calculation
        // Solar noon = 0.5, sunrise/sunset = 0 or 1
        // This creates a sine wave peaking at noon
        
        const hourAngle = (this.timeOfDay - 0.5) * Math.PI * 2; // -π to π
        const declination = 0; // Simplified (equinox)
        const latRad = this.latitude * Math.PI / 180;
        
        // Solar elevation angle (simplified)
        const elevation = Math.asin(
            Math.sin(latRad) * Math.sin(declination) +
            Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle)
        ) * 180 / Math.PI;
        
        return Math.max(-90, Math.min(90, elevation));
    }
    
    updateFrequencies() {
        if (!this.isRunning) return;
        
        // Map sun elevation to fundamental frequency
        // OLD SYSTEM: Used sun elevation
        // NEW SYSTEM: 24-hour sine wave centered on A440
        // Noon (12pm) = A440, 6pm = A880 (1 octave up), 6am = A220 (1 octave down), Midnight = A440
        
        // timeOfDay is 0.0 to 1.0 (0 = midnight, 0.5 = noon, 1.0 = midnight)
        // Convert to hours for clarity: 0-24
        const hours = this.timeOfDay * 24;
        
        // Sine wave: peaks at 18 (6pm), troughs at 6 (6am), crosses reference at 0/12/24
        // Phase shift so that noon (12) and midnight (0/24) are at reference A440
        const phaseShift = (hours - 12) / 24 * 2 * Math.PI; // -π to π, centered at noon
        
        // Sine wave gives us -1 to +1, map to octave range
        // sin value: -1 at 6am (one octave down), 0 at noon/midnight, +1 at 6pm (one octave up)
        const octaveDeviation = Math.sin(phaseShift); // -1 to +1
        
        // A440 * 2^octaveDeviation gives us the frequency
        // octaveDeviation = -1 → 220Hz (A220), 0 → 440Hz (A440), +1 → 880Hz (A880)
        const referenceA = 440;
        const baseFreq = referenceA * Math.pow(2, octaveDeviation);
        
        // Apply mode-specific adjustments while maintaining the A-based fundamental
        let fundamentalFreq;
        if (this.mode === 'pulse') {
            // Pulse: much wider range, scale up for variation
            fundamentalFreq = baseFreq * (Math.random() * 10 + 1); // 440Hz-4840Hz range with variation
        } else if (this.mode === 'bell') {
            // Bell: lower frequencies for deeper bell tones (2 octaves down from original)
            fundamentalFreq = baseFreq * (Math.random() * 1.5 + 0.75); // 330Hz-990Hz range (was 1320Hz-3960Hz)
        } else {
            // Drone: keep closer to pure A tuning, slight range for interest
            fundamentalFreq = baseFreq * (Math.random() * 0.5 + 0.75); // ~330Hz-660Hz from base A440
        }
        
        this.fundamentalFreq = fundamentalFreq;
        
        // Temperature drift (hotter = more drift)
        const tempDrift = (this.temperature - 20) * 0.5; // ±10Hz per 20°C deviation
        const randomDrift = (Math.random() - 0.5) * Math.abs(tempDrift);
        
        // Calculate sun elevation for filter control
        this.sunElevation = this.calculateSunElevation();
        
        // Use sun elevation to control filters (timbre, not pitch)
        // Low sun (sunrise/sunset, negative elevation) = Low-pass dominant (dark, muffled)
        // High sun (noon, positive elevation) = High-pass dominant (bright, thin)
        const elevationNorm = Math.max(-20, Math.min(70, this.sunElevation));
        const elevationFactor = (elevationNorm + 20) / 90; // 0 to 1 (0 = sunrise, 1 = noon)
        
        // LOW-PASS FILTER: Controlled primarily by sun position
        // Low sun = aggressive low-pass (500Hz - very dark)
        // High sun = open low-pass (5000Hz - bright)
        const sunBasedLPF = 500 + elevationFactor * 4500;
        const latNorm = (this.latitude + 90) / 180;
        const latModulation = latNorm * 1000; // Latitude adds variation ±1000Hz
        this.lowPassFilter.frequency.value = sunBasedLPF + latModulation;
        
        // HIGH-PASS FILTER: Inverse relationship with sun
        // Low sun = high HPF cut (200Hz - removes bass, thin sound)
        // High sun = low HPF cut (50Hz - keeps bass, full sound)
        const sunBasedHPF = 200 - (elevationFactor * 150);
        const lonNorm = (this.longitude + 180) / 360;
        const lonModulation = lonNorm * 50; // Longitude adds variation ±50Hz
        this.highPassFilter.frequency.value = sunBasedHPF + lonModulation;
        
        // Get scale tones based on compass and selected scale
        const compassTones = this.getScaleTones();
        
        // Check if heading has changed significantly (more than 5 degrees)
        const headingChanged = Math.abs(this.heading - this.lastHeading) > 5;
        
        // Determine if we use multipliers (low fund) or divisors (high fund)
        const useSubharmonics = this.fundamentalFreq > 200; // Lowered from 1000 - more likely to use subharmonics
        
        // Set fundamental (oscillator 0) - always the root
        const fund = this.fundamentalFreq + randomDrift;
        this.setOscillatorFrequency(0, fund);
        
        // Oscillators 1, 2, 4, 5, 6, 7 = 6 chord tones
        // We'll distribute the chord tones across octaves
        const harmonicIndices = [1, 2, 4, 5, 6, 7];
        
        harmonicIndices.forEach((oscIdx, i) => {
            // Cycle through scale tones, doubling at octaves
            const tone = compassTones[i % compassTones.length];
            const octaveMultiplier = Math.floor(i / compassTones.length) + 1;
            
            let harmonic;
            if (useSubharmonics) {
                // High fundamental: use subharmonics (divide)
                harmonic = fund / (tone * octaveMultiplier);
            } else {
                // Low fundamental: use harmonics (multiply)
                harmonic = fund * tone * octaveMultiplier;
            }
            
            // Mode-specific octave shifts
            if (this.mode === 'pulse') {
                // Pulse: extreme shifts for wide frequency spread
                if (oscIdx <= 2) {
                    harmonic = harmonic * 0.25; // Down two octaves
                }
                else if (oscIdx >= 5) {
                    harmonic = harmonic * 4.0; // Up two octaves
                }
            } else if (this.mode === 'bell') {
                // Bell: keep harmonics lower (removed upward octave shifts)
                if (oscIdx <= 2) {
                    harmonic = harmonic * 1.0; // Normal pitch (was ×2 up one octave)
                } else if (oscIdx >= 5) {
                    harmonic = harmonic * 2.0; // Up one octave (was ×8 up three octaves)
                }
            } else {
                // Drone mode: spread spectrum more - normal bass AND high shimmer
                if (oscIdx === 1 || oscIdx === 2) {
                    harmonic = harmonic * 1.0; // Normal pitch (no shift)
                } else if (oscIdx === 6 || oscIdx === 7) {
                    harmonic = harmonic * 8.0; // Ultra high shimmer (3 octaves up)
                } else if (oscIdx === 5) {
                    harmonic = harmonic * 4.0; // High (2 octaves up)
                }
            }
            
            // Update frequency immediately for all oscillators
            this.setOscillatorFrequency(oscIdx, harmonic);
        });
        
        // Update last heading for next comparison
        this.lastHeading = this.heading;
        
        // Oscillator 3: Direct speed control (independent of fundamental)
        const speedNorm = Math.min(this.speed / 35.8, 1);
        let speedFreq = 50 + (speedNorm * 950);
        
        // In pulse/bell modes, shift based on speed more extremely
        if (this.mode === 'pulse' || this.mode === 'bell') {
            if (speedNorm < 0.5) {
                speedFreq = speedFreq * 0.25; // Very low for slow speeds
            } else {
                speedFreq = speedFreq * 4.0; // Very high for fast speeds
            }
        }
        
        this.setOscillatorFrequency(3, speedFreq);
        
        // No vibrato - perfectly stable oscillators
        
        // Filters now controlled by sun position (see earlier in updateFrequencies)
        
        // Update reverb wet/dry based on humidity (increased reverb)
        const humidityNorm = this.humidity / 100; // 0 to 1
        this.dryGain.gain.value = 0.85 - (humidityNorm * 0.30); // 0.85 to 0.55 (was 0.95 to 0.7)
        this.wetGain.gain.value = 0.15 + (humidityNorm * 0.45); // 0.15 to 0.60 (was 0.05 to 0.35)
        
        // Update stereo panning based on compass heading
        // Map heading to pan position, avoiding hard left/right
        // 0° (North) = center, 90° (East) = right, 180° (South) = center, 270° (West) = left
        const headingRad = (this.heading * Math.PI) / 180;
        const panPosition = Math.sin(headingRad) * 0.7; // ±0.7 max (avoiding ±1.0)
        
        // Apply panning to all oscillators with slight variations
        this.panners.forEach((panner, i) => {
            // Population density affects stereo spread (cohesion)
            // High density (urban) = narrow stereo (individual/distinct tones)
            // Low density (rural) = wide stereo (cohesive chordal groups)
            const densitySpread = 1.0 - (this.populationDensity * 0.7); // 1.0 (rural) to 0.3 (urban)
            
            // Each oscillator gets offset scaled by population density
            const baseOffset = (i - 3.5) * 0.05; // -0.175 to +0.175
            const offset = baseOffset * densitySpread;
            const finalPan = Math.max(-0.8, Math.min(0.8, panPosition + offset));
            panner.pan.value = finalPan;
        });
        
        // TRAFFIC DENSITY → DISSONANT GLISSANDO
        if (this.trafficOscillator && this.trafficGain) {
            const now = this.audioContext.currentTime;
            
            if (this.trafficDensity > 0.3) {
                // Traffic present (only activate at moderate traffic or higher)
                
                // Volume based on traffic density (MUCH more subtle)
                const targetVolume = this.trafficDensity * 0.01; // Very subtle, max 1% volume (was 3%)
                this.trafficGain.gain.cancelScheduledValues(now);
                this.trafficGain.gain.setValueAtTime(this.trafficGain.gain.value, now);
                this.trafficGain.gain.linearRampToValueAtTime(targetVolume, now + 0.5);
                
                // Glissando rate based on traffic density
                // Low traffic = moderate rise (dissonant but bearable)
                // High traffic = VERY SLOW rise (excruciating dissonance)
                const riseTime = 8 + (this.trafficDensity * 22); // 8s (low) to 30s (high)
                
                // Target frequency: dissonant interval from fundamental
                // Minor 2nd (semitone) = very dissonant
                const targetFreq = this.fundamentalFreq * 1.059; // Semitone above fundamental
                
                // Start from fundamental and gliss up
                this.trafficOscillator.frequency.cancelScheduledValues(now);
                this.trafficOscillator.frequency.setValueAtTime(this.fundamentalFreq, now);
                this.trafficOscillator.frequency.linearRampToValueAtTime(targetFreq, now + riseTime);
                
                // After reaching target, gliss back down and repeat
                setTimeout(() => {
                    if (this.isRunning && this.trafficDensity > 0.1) {
                        const futureNow = this.audioContext.currentTime;
                        this.trafficOscillator.frequency.cancelScheduledValues(futureNow);
                        this.trafficOscillator.frequency.setValueAtTime(targetFreq, futureNow);
                        this.trafficOscillator.frequency.linearRampToValueAtTime(this.fundamentalFreq, futureNow + riseTime);
                    }
                }, riseTime * 1000);
                
            } else {
                // Low/no traffic - fade out glissando quickly
                this.trafficGain.gain.cancelScheduledValues(now);
                this.trafficGain.gain.setValueAtTime(this.trafficGain.gain.value, now);
                this.trafficGain.gain.linearRampToValueAtTime(0, now + 1); // Faster fadeout (1s)
            }
        }
        
        // Notify UI
        if (this.onFrequencyUpdate) {
            const freqs = this.oscillators.map(osc => osc.frequency.value);
            this.onFrequencyUpdate(freqs);
        }
    }
    
    getScaleTones() {
        // Returns 6 tones from the selected scale based on compass heading
        const headingNorm = this.heading % 360;
        
        let scaleRatios;
        
        switch(this.scale) {
            case 'dreyblatt':
                // Arnold Dreyblatt's 20-tone scale (harmonics 8-27)
                scaleRatios = [
                    1.0, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875, 2.0, 2.125,
                    2.25, 2.375, 2.5, 2.625, 2.75, 2.875, 3.0, 3.125, 3.25, 3.375
                ];
                break;
                
            case 'harmonic':
                // Pure harmonic series (Grisey-style, harmonics 1-20)
                scaleRatios = [
                    1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0,
                    11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0, 20.0
                ];
                break;
                
            case 'slendro':
                // Indonesian Slendro (5-tone gamelan scale, octave-repeating)
                const slendroBase = [1.0, 1.2, 1.4, 1.68, 1.87]; // Approximate ratios
                scaleRatios = [
                    ...slendroBase,
                    ...slendroBase.map(r => r * 2),
                    ...slendroBase.map(r => r * 3),
                    ...slendroBase.map(r => r * 4)
                ];
                break;
                
            case 'pelog':
                // Indonesian Pelog (7-tone gamelan scale, unequal intervals)
                const pelogBase = [1.0, 1.122, 1.26, 1.414, 1.587, 1.682, 1.888]; // Approximate ratios
                scaleRatios = [
                    ...pelogBase,
                    ...pelogBase.map(r => r * 2),
                    ...pelogBase.map(r => r * 3)
                ];
                break;
                
            case 'quartertone':
                // 24-EDO (quarter-tone system)
                scaleRatios = Array.from({length: 24}, (_, i) => 
                    Math.pow(2, i / 24) // 2^(n/24) for equal divisions
                );
                break;
                
            default:
                scaleRatios = [1.0, 1.125, 1.25, 1.5, 1.75, 2.0]; // Fallback
        }
        
        // Select 6 tones from the scale based on compass heading (same logic as before)
        let selectedTones = [];
        
        if (headingNorm < 90) {
            const t = headingNorm / 90;
            const startIdx = Math.floor(t * Math.min(4, scaleRatios.length - 10));
            selectedTones = [
                scaleRatios[startIdx],
                scaleRatios[Math.min(startIdx + 2, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 4, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 6, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 8, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 10, scaleRatios.length - 1)]
            ];
        } else if (headingNorm < 180) {
            const t = (headingNorm - 90) / 90;
            const startIdx = Math.floor(5 + t * Math.min(5, scaleRatios.length - 15));
            selectedTones = [
                scaleRatios[Math.min(startIdx, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 1, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 3, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 5, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 7, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 9, scaleRatios.length - 1)]
            ];
        } else if (headingNorm < 270) {
            const t = (headingNorm - 180) / 90;
            const startIdx = Math.floor(10 + t * Math.min(6, scaleRatios.length - 16));
            selectedTones = [
                scaleRatios[Math.min(startIdx, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 2, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 4, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 6, scaleRatios.length - 1)],
                scaleRatios[Math.min(startIdx + 8, scaleRatios.length - 1)],
                scaleRatios[scaleRatios.length - 1]
            ];
        } else {
            const t = (headingNorm - 270) / 90;
            const spread = Math.floor(t * 3);
            selectedTones = [
                scaleRatios[Math.min(0 + spread, scaleRatios.length - 1)],
                scaleRatios[Math.min(4 + spread, scaleRatios.length - 1)],
                scaleRatios[Math.min(8 + spread, scaleRatios.length - 1)],
                scaleRatios[Math.min(12 + spread, scaleRatios.length - 1)],
                scaleRatios[Math.min(16 + spread, scaleRatios.length - 1)],
                scaleRatios[scaleRatios.length - 1]
            ];
        }
        
        return selectedTones;
    }
    
    interpolateChords(chord1, chord2, t) {
        // No longer needed with Dreyblatt scale, but keeping for compatibility
        const maxLen = Math.max(chord1.length, chord2.length);
        const c1 = [...chord1];
        const c2 = [...chord2];
        
        while (c1.length < maxLen) c1.push(c1[c1.length - 1] * 2);
        while (c2.length < maxLen) c2.push(c2[c2.length - 1] * 2);
        
        return c1.map((val, i) => val + (c2[i] - val) * t);
    }
    
    setOscillatorFrequency(index, frequency) {
        if (!this.oscillators[index]) return;
        
        const now = this.audioContext.currentTime;
        const osc = this.oscillators[index];
        
        // No pitch drift - perfectly stable tones
        const organicFreq = frequency;
        
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, Math.min(20000, organicFreq)),
            now + 2.0  // 2 second smooth glide (was 0.1s which created stepping)
        );
    }
}
