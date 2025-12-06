class EnvironmentalAudioEngine {
    constructor() {
        this.audioContext = null;
        this.oscillators = [];
        this.gainNodes = [];
        this.convolver = null;
        this.masterGain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.lowPassFilter = null;
        this.highPassFilter = null;
        this.isRunning = false;
        
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
        this.dryGain.gain.value = 0.7; // Default 70% dry
        this.wetGain.gain.value = 0.3; // Default 30% wet
        
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
            
            // Create vibrato LFO for each oscillator
            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();
            lfo.frequency.value = 5 + Math.random() * 3; // 5-8 Hz vibrato rate
            lfoGain.gain.value = 0; // Will be controlled by speed
            
            lfo.connect(lfoGain);
            lfoGain.connect(oscillator.frequency);
            lfo.start();
            
            this.vibratoLFOs.push({ lfo, lfoGain });
            
            oscillator.type = 'sine';
            oscillator.frequency.value = 200;
            
            // Start at 0 volume (sporadic)
            gainNode.gain.value = 0;
            
            oscillator.connect(gainNode);
            
            // Fundamental (osc 0) goes through filters, harmonics bypass filters
            if (i === 0) {
                gainNode.connect(this.highPassFilter);
                this.highPassFilter.connect(this.lowPassFilter);
                this.lowPassFilter.connect(this.dryGain);
                this.lowPassFilter.connect(this.wetGain);
            } else {
                gainNode.connect(this.dryGain);
                gainNode.connect(this.wetGain);
            }
            
            oscillator.start();
            
            this.oscillators.push(oscillator);
            this.gainNodes.push(gainNode);
        }
        
        this.isRunning = true;
        this.updateFrequencies();
        
        // Start sporadic behavior for ALL oscillators
        this.startSporadicOscillators();
    }
    
    createReverbImpulse() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 3.5;
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
    
    scheduleSporadicPulse(oscIndex) {
        // Speed-dependent timing for oscillators 4-7
        const isSpeedControlled = oscIndex >= 4;
        
        let interval, duration;
        
        if (isSpeedControlled) {
            // Speed affects pulse frequency
            // Slow (0 m/s) = 8-16 sec intervals (infrequent)
            // Fast (35.8 m/s / 80 mph) = 1-4 sec intervals (rapid)
            const speedNorm = Math.min(this.speed / 35.8, 1);
            const minInterval = 8000 - (speedNorm * 7000); // 8s to 1s
            const maxInterval = 16000 - (speedNorm * 12000); // 16s to 4s
            interval = minInterval + Math.random() * (maxInterval - minInterval);
        } else {
            // Fixed timing for oscillators 0-3
            interval = 3000 + Math.random() * 13000; // 3-16 seconds
        }
        
        duration = 1000 + Math.random() * 5000; // 1-6 seconds (same for all)
        
        const fadeIn = 0.2 + Math.random() * 0.5; // 0.2-0.7s fade in
        const fadeOut = 0.3 + Math.random() * 1.0; // 0.3-1.3s fade out
        
        const timer = setTimeout(() => {
            if (!this.isRunning) return;
            
            this.fadeIn(oscIndex, fadeIn, 0.04); // Volume 0.04 per oscillator
            
            setTimeout(() => {
                if (!this.isRunning) return;
                this.fadeOut(oscIndex, fadeOut);
                
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
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(targetVolume, now + duration);
    }
    
    fadeOut(oscIndex, duration) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + duration);
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
        
        // Calculate sun elevation
        this.sunElevation = this.calculateSunElevation();
        
        // Map sun elevation to fundamental frequency
        // Elevation -90° to 90°, but we care about -20° to 70° roughly
        // Solar noon (high elevation) = 200Hz (low freq)
        // Sunrise/sunset (low/negative elevation) = 4800Hz (high freq)
        const elevationNorm = Math.max(-20, Math.min(70, this.sunElevation));
        const elevationFactor = (elevationNorm + 20) / 90; // 0 to 1
        
        // INVERTED: high elevation = low freq
        // Two octaves down: 1200Hz to 50Hz (was 4800 to 200)
        this.fundamentalFreq = 1200 - (elevationFactor * 1150); // 1200 to 50
        
        // Temperature drift (hotter = more drift)
        const tempDrift = (this.temperature - 20) * 0.5; // ±10Hz per 20°C deviation
        const randomDrift = (Math.random() - 0.5) * Math.abs(tempDrift);
        
        // Get compass chord (3-4 ratios depending on direction)
        const compassChord = this.getCompassChord();
        
        // Determine if we use multipliers (low fund) or divisors (high fund)
        const useSubharmonics = this.fundamentalFreq > 500; // Adjusted threshold
        
        // Set fundamental (oscillator 0) - always the root
        const fund = this.fundamentalFreq + randomDrift;
        this.setOscillatorFrequency(0, fund);
        
        // Oscillators 1, 2, 4, 5, 6, 7 = 6 chord tones
        // We'll distribute the chord tones across octaves
        const harmonicIndices = [1, 2, 4, 5, 6, 7];
        
        harmonicIndices.forEach((oscIdx, i) => {
            // Cycle through chord tones, doubling at octaves
            const chordTone = compassChord[i % compassChord.length];
            const octaveMultiplier = Math.floor(i / compassChord.length) + 1;
            
            let harmonic;
            if (useSubharmonics) {
                // High fundamental: use subharmonics (divide)
                harmonic = fund / (chordTone * octaveMultiplier);
            } else {
                // Low fundamental: use harmonics (multiply)
                harmonic = fund * chordTone * octaveMultiplier;
            }
            
            this.setOscillatorFrequency(oscIdx, harmonic);
        });
        
        // Oscillator 3: Direct speed control (independent of fundamental)
        // One octave down: 50Hz to 1000Hz (was 100Hz to 2000Hz)
        const speedNorm = Math.min(this.speed / 35.8, 1);
        const speedFreq = 50 + (speedNorm * 950);
        this.setOscillatorFrequency(3, speedFreq);
        
        // Update vibrato/tremolo based on speed (INVERTED)
        // Slow speed = more vibrato, fast speed = less
        // (reusing speedNorm from above)
        const vibratoDepth = 5.5 - (speedNorm * 5); // 5.5Hz at 0 speed, 0.5Hz at max speed
        
        this.vibratoLFOs.forEach(({ lfoGain }) => {
            lfoGain.gain.value = vibratoDepth;
        });
        
        // Update filters based on lat/lon
        // Higher latitude = lower low-pass cutoff
        // Lower latitude = higher low-pass cutoff
        const latNorm = (this.latitude + 90) / 180; // 0 to 1
        const lowPassFreq = 500 + latNorm * 4500; // 500Hz to 5000Hz
        this.lowPassFilter.frequency.value = lowPassFreq;
        
        // Longitude affects high-pass
        const lonNorm = (this.longitude + 180) / 360; // 0 to 1
        const highPassFreq = 50 + lonNorm * 450; // 50Hz to 500Hz
        this.highPassFilter.frequency.value = highPassFreq;
        
        // Update reverb wet/dry based on humidity
        const humidityNorm = this.humidity / 100; // 0 to 1
        this.dryGain.gain.value = 0.9 - (humidityNorm * 0.5); // 0.9 to 0.4
        this.wetGain.gain.value = 0.1 + (humidityNorm * 0.6); // 0.1 to 0.7
        
        // Notify UI
        if (this.onFrequencyUpdate) {
            const freqs = this.oscillators.map(osc => osc.frequency.value);
            this.onFrequencyUpdate(freqs);
        }
    }
    
    getCompassChord() {
        // Arnold Dreyblatt's 20-tone microtonal scale
        // Based on harmonics 8-27 of the overtone series
        // Ratios: 8:8 through 27:8
        const dreyblattScale = [
            1.0,    // 8:8
            1.125,  // 9:8
            1.25,   // 10:8
            1.375,  // 11:8
            1.5,    // 12:8
            1.625,  // 13:8
            1.75,   // 14:8
            1.875,  // 15:8
            2.0,    // 16:8
            2.125,  // 17:8
            2.25,   // 18:8
            2.375,  // 19:8
            2.5,    // 20:8
            2.625,  // 21:8
            2.75,   // 22:8
            2.875,  // 23:8
            3.0,    // 24:8
            3.125,  // 25:8
            3.25,   // 26:8
            3.375   // 27:8
        ];
        
        // Map compass heading (0-360°) to select 6 tones from the 20-tone scale
        // Different cardinal directions emphasize different regions of the scale
        const headingNorm = this.heading % 360;
        
        let selectedTones = [];
        
        if (headingNorm < 90) {
            // North (0-90°): Lower harmonics (indices 0-9)
            // Interpolate between starting positions in the scale
            const t = headingNorm / 90;
            const startIdx = Math.floor(t * 4); // 0-4
            selectedTones = [
                dreyblattScale[startIdx],
                dreyblattScale[startIdx + 2],
                dreyblattScale[startIdx + 4],
                dreyblattScale[startIdx + 6],
                dreyblattScale[startIdx + 8],
                dreyblattScale[Math.min(startIdx + 10, 19)]
            ];
        } else if (headingNorm < 180) {
            // East (90-180°): Mid-range harmonics (indices 5-14)
            const t = (headingNorm - 90) / 90;
            const startIdx = 5 + Math.floor(t * 5);
            selectedTones = [
                dreyblattScale[startIdx],
                dreyblattScale[startIdx + 1],
                dreyblattScale[startIdx + 3],
                dreyblattScale[startIdx + 5],
                dreyblattScale[Math.min(startIdx + 7, 19)],
                dreyblattScale[Math.min(startIdx + 9, 19)]
            ];
        } else if (headingNorm < 270) {
            // South (180-270°): Upper harmonics (indices 10-19)
            const t = (headingNorm - 180) / 90;
            const startIdx = 10 + Math.floor(t * 6);
            selectedTones = [
                dreyblattScale[Math.min(startIdx, 19)],
                dreyblattScale[Math.min(startIdx + 2, 19)],
                dreyblattScale[Math.min(startIdx + 4, 19)],
                dreyblattScale[Math.min(startIdx + 6, 19)],
                dreyblattScale[Math.min(startIdx + 8, 19)],
                dreyblattScale[19]
            ];
        } else {
            // West (270-360°): Distributed across full range
            const t = (headingNorm - 270) / 90;
            const spread = Math.floor(t * 3);
            selectedTones = [
                dreyblattScale[0 + spread],
                dreyblattScale[4 + spread],
                dreyblattScale[8 + spread],
                dreyblattScale[12 + spread],
                dreyblattScale[Math.min(16 + spread, 19)],
                dreyblattScale[19]
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
        
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, Math.min(20000, frequency)),
            now + 0.1
        );
    }
}
