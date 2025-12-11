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
        
        // Playback mode: 'drone' or 'percussive'
        this.mode = 'drone';
        
        // Waveform type: 'sine', 'triangle', 'sawtooth'
        this.waveform = 'sine';
        
        // Scale type: 'dreyblatt', 'partch', 'harmonic', 'slendro', 'just', 'quartertone', 'yo'
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
        
        // Vibrato/tremolo LFOs
        this.vibratoLFOs = [];
        
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
        this.masterGain.gain.value = 0.8;
        
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
            
            // Create vibrato LFO for each oscillator
            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();
            lfo.frequency.value = 5 + Math.random() * 3; // 5-8 Hz vibrato rate
            lfoGain.gain.value = 0; // Will be controlled by speed
            
            lfo.connect(lfoGain);
            lfoGain.connect(oscillator.frequency);
            lfo.start();
            
            this.vibratoLFOs.push({ lfo, lfoGain });
            
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
        
        this.isRunning = true;
        this.updateFrequencies();
        
        // Start sporadic behavior for ALL oscillators
        this.startSporadicOscillators();
    }
    
    createReverbImpulse() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 0.875; // Reduced from 1.75s to 0.875s (tighter reverb)
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
        // Switch between 'sine', 'triangle', 'sawtooth'
        this.waveform = waveform;
        
        // Update all oscillator types
        this.oscillators.forEach(osc => {
            osc.type = waveform;
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
        
        if (this.mode === 'percussive') {
            // PERCUSSIVE MODE: Short, sharp bursts, slower rate
            duration = 50 + Math.random() * 250; // 50-300ms
            fadeIn = (20 + Math.random() * 60) / 1000; // 20-80ms attack (smoother to prevent clipping)
            fadeOut = (10 + Math.random() * 40) / 1000; // 10-50ms release
            
            if (isSpeedOscillator) {
                // Oscillator 3: VERY dramatic speed response
                const speedNorm = Math.min(this.speed / 35.8, 1);
                const minInterval = 10000 - (speedNorm * 9500); // 10s to 0.5s
                const maxInterval = 20000 - (speedNorm * 19000); // 20s to 1s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else if (isSpeedControlled) {
                // Speed affects pulse density
                const speedNorm = Math.min(this.speed / 35.8, 1);
                const minInterval = 3000 - (speedNorm * 1000); // 3s to 2s
                const maxInterval = 8000 - (speedNorm * 3000); // 8s to 5s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                interval = 2000 + Math.random() * 6000; // 2s-8s
            }
        } else {
            // DRONE MODE: Longer, sustained tones
            duration = 1000 + Math.random() * 5000; // 1-6 seconds
            fadeIn = 0.2 + Math.random() * 0.5; // 0.2-0.7s
            fadeOut = 0.3 + Math.random() * 1.0; // 0.3-1.3s
            
            if (isSpeedOscillator) {
                // Oscillator 3: dramatic speed response in drone mode too
                const speedNorm = Math.min(this.speed / 35.8, 1);
                const minInterval = 12000 - (speedNorm * 10000); // 12s to 2s
                const maxInterval = 20000 - (speedNorm * 16000); // 20s to 4s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else if (isSpeedControlled) {
                const speedNorm = Math.min(this.speed / 35.8, 1);
                const minInterval = 8000 - (speedNorm * 7000); // 8s to 1s
                const maxInterval = 16000 - (speedNorm * 12000); // 16s to 4s
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                interval = 3000 + Math.random() * 13000; // 3-16 seconds
            }
        }
        
        const timer = setTimeout(() => {
            if (!this.isRunning) return;
            
            // Convert ms to seconds for drone mode fade times
            const fadeInSec = this.mode === 'percussive' ? fadeIn : fadeIn;
            const fadeOutSec = this.mode === 'percussive' ? fadeOut : fadeOut;
            
            // Volume based on mode - higher for percussive now that attack is smoother
            let targetVolume = this.mode === 'percussive' ? 0.035 : 0.04;
            
            // In drone mode, boost lower oscillators for bass presence (reduced)
            if (this.mode === 'drone' && oscIndex <= 2) {
                targetVolume *= 1.15; // Boost bass by 15% (was 30%)
            }
            
            // In drone mode, reduce mid-range but keep ultra-highs audible
            if (this.mode === 'drone' && oscIndex === 4) {
                targetVolume *= 0.5; // Cut mid-range significantly
            } else if (this.mode === 'drone' && oscIndex === 5) {
                targetVolume *= 0.5; // Reduce high-mid
            } else if (this.mode === 'drone' && (oscIndex === 6 || oscIndex === 7)) {
                targetVolume *= 0.6; // Keep ultra-highs more present (was 0.4)
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
        
        // Add gentle amplitude flutter (subtle random modulation)
        const flutter = (Math.random() - 0.5) * 0.005; // ±0.5% volume variation
        const organicVolume = targetVolume * (1 + flutter);
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(organicVolume, now + organicDuration);
    }
    
    fadeOut(oscIndex, duration) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        
        // Add slight irregularity to release
        const irregularity = (Math.random() - 0.5) * 0.02;
        const organicDuration = Math.max(0.01, duration + irregularity);
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + organicDuration);
    }
    
    stop() {
        if (!this.isRunning) return;
        
        // Clear sporadic timers
        this.sporadicTimers.forEach(timer => clearTimeout(timer));
        this.sporadicTimers = [];
        
        // Stop LFOs
        this.vibratoLFOs.forEach(({ lfo }) => {
            try {
                lfo.stop();
            } catch (e) {}
        });
        this.vibratoLFOs = [];
        
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
    
    setEnvironmentalData(lat, lon, speed, temp, humidity, heading, timeOfDay) {
        this.latitude = lat;
        this.longitude = lon;
        this.speed = speed;
        this.temperature = temp;
        this.humidity = humidity;
        this.heading = heading;
        this.timeOfDay = timeOfDay;
        
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
        if (this.mode === 'percussive') {
            // Percussive: much wider range, scale up for variation
            fundamentalFreq = baseFreq * (Math.random() * 10 + 1); // 440Hz-4840Hz range with variation
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
            
            // In percussive mode, shift octaves more extremely to widen frequency spread
            if (this.mode === 'percussive') {
                // Lower oscillators (1, 2) go down two octaves
                if (oscIdx <= 2) {
                    harmonic = harmonic * 0.25;
                }
                // Higher oscillators (5, 6, 7) go up two octaves
                else if (oscIdx >= 5) {
                    harmonic = harmonic * 4.0;
                }
                // Middle oscillator (4) stays same
            } else {
                // Drone mode: spread spectrum more - deep bass AND high shimmer
                if (oscIdx === 1 || oscIdx === 2) {
                    harmonic = harmonic * 0.5; // Bass region
                } else if (oscIdx === 6 || oscIdx === 7) {
                    harmonic = harmonic * 8.0; // Ultra high shimmer (3 octaves up)
                } else if (oscIdx === 5) {
                    harmonic = harmonic * 4.0; // High (2 octaves up)
                }
            }
            
            this.setOscillatorFrequency(oscIdx, harmonic);
        });
        
        // Oscillator 3: Direct speed control (independent of fundamental)
        // One octave down: 50Hz to 1000Hz (was 100Hz to 2000Hz)
        const speedNorm = Math.min(this.speed / 35.8, 1);
        let speedFreq = 50 + (speedNorm * 950);
        
        // In percussive mode, shift based on speed more extremely
        // Slow = much lower (×0.25), Fast = much higher (×4.0)
        if (this.mode === 'percussive') {
            if (speedNorm < 0.5) {
                speedFreq = speedFreq * 0.25; // Very low for slow speeds
            } else {
                speedFreq = speedFreq * 4.0; // Very high for fast speeds
            }
        }
        
        this.setOscillatorFrequency(3, speedFreq);
        
        // Update vibrato/tremolo based on speed (INVERTED)
        // Slow speed = more vibrato, fast speed = less
        // (reusing speedNorm from above)
        const vibratoDepth = 5.5 - (speedNorm * 5); // 5.5Hz at 0 speed, 0.5Hz at max speed
        
        this.vibratoLFOs.forEach(({ lfoGain }) => {
            lfoGain.gain.value = vibratoDepth;
        });
        
        // Filters now controlled by sun position (see earlier in updateFrequencies)
        
        // Update reverb wet/dry based on humidity (more subtle now)
        const humidityNorm = this.humidity / 100; // 0 to 1
        this.dryGain.gain.value = 0.95 - (humidityNorm * 0.25); // 0.95 to 0.7 (drier overall)
        this.wetGain.gain.value = 0.05 + (humidityNorm * 0.30); // 0.05 to 0.35 (max wet halved from 0.7)
        
        // Update stereo panning based on compass heading
        // Map heading to pan position, avoiding hard left/right
        // 0° (North) = center, 90° (East) = right, 180° (South) = center, 270° (West) = left
        const headingRad = (this.heading * Math.PI) / 180;
        const panPosition = Math.sin(headingRad) * 0.7; // ±0.7 max (avoiding ±1.0)
        
        // Apply panning to all oscillators with slight variations
        this.panners.forEach((panner, i) => {
            // Each oscillator gets slightly offset pan for stereo width
            const offset = (i - 3.5) * 0.05; // -0.175 to +0.175
            const finalPan = Math.max(-0.8, Math.min(0.8, panPosition + offset));
            panner.pan.value = finalPan;
        });
        
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
                
            case 'partch':
                // Harry Partch's 43-tone just intonation (subset of key ratios)
                scaleRatios = [
                    1.0, 1.0125, 1.125, 1.25, 1.3333, 1.5, 1.6, 1.6875, 1.75, 1.875,
                    2.0, 2.25, 2.5, 2.6667, 3.0, 3.2, 3.375, 3.5, 3.75, 4.0
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
                
            case 'just':
                // Classic Just Intonation (major scale ratios)
                const justBase = [1.0, 1.125, 1.25, 1.333, 1.5, 1.667, 1.875]; // 9/8, 5/4, 4/3, 3/2, 5/3, 15/8
                scaleRatios = [
                    ...justBase,
                    ...justBase.map(r => r * 2),
                    ...justBase.map(r => r * 3)
                ];
                break;
                
            case 'quartertone':
                // 24-EDO (quarter-tone system)
                scaleRatios = Array.from({length: 24}, (_, i) => 
                    Math.pow(2, i / 24) // 2^(n/24) for equal divisions
                );
                break;
                
            case 'yo':
                // Japanese Yo scale (pentatonic used in Gagaku)
                // Ratios approximate traditional tuning
                const yoBase = [1.0, 1.125, 1.333, 1.5, 1.6875]; // Roughly C D F G A
                scaleRatios = [
                    ...yoBase,
                    ...yoBase.map(r => r * 2),
                    ...yoBase.map(r => r * 3),
                    ...yoBase.map(r => r * 4)
                ];
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
        
        // Add subtle pitch instability for organic sound (±0.15Hz random drift, reduced from 0.3Hz)
        const pitchDrift = (Math.random() - 0.5) * 0.3;
        const organicFreq = frequency + pitchDrift;
        
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, Math.min(20000, organicFreq)),
            now + 0.1
        );
    }
}
