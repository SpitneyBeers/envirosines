class EnvironmentalAudioEngine {
    constructor() {
        this.audioContext = null;
        this.oscillators = [];
        this.gainNodes = [];
        this.panners = [];
        this.convolver = null;
        this.masterGain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.lowPassFilter = null;
        this.highPassFilter = null;
        this.isRunning = false;
        
        this.mode = 'drone';
        this.waveform = 'sine';
        this.scale = 'dreyblatt';
        this.fundamentalFreq = 200;
        this.sporadicTimers = [];
        
        this.latitude = 0;
        this.longitude = 0;
        this.speed = 0;
        this.temperature = 20;
        this.humidity = 50;
        this.heading = 0;
        this.timeOfDay = 0.5;
        this.elevation = 0;
        this.rainfall = 0;
        this.sunElevation = 0;
        this.populationDensity = 0.5;
        this.trafficDensity = 0.0;
        this.lastHeading = 0;
        this.pendingFrequencyUpdates = [];
        this.trafficOscillator = null;
        this.trafficGain = null;
        this.onFrequencyUpdate = null;
    }
    
    async start() {
        if (this.isRunning) return;
        
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        setTimeout(() => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }, 100);
        
        this.convolver = this.audioContext.createConvolver();
        this.convolver.buffer = this.createReverbImpulse();
        
        this.dryGain = this.audioContext.createGain();
        this.wetGain = this.audioContext.createGain();
        this.dryGain.gain.value = 0.85;
        this.wetGain.gain.value = 0.15;
        
        this.lowPassFilter = this.audioContext.createBiquadFilter();
        this.lowPassFilter.type = 'lowpass';
        this.lowPassFilter.frequency.value = 5000;
        
        this.highPassFilter = this.audioContext.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 100;
        
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1.0;
        
        this.dryGain.connect(this.masterGain);
        this.wetGain.connect(this.convolver);
        this.convolver.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
        
        for (let i = 0; i < 8; i++) {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const panner = this.audioContext.createStereoPanner();
            
            panner.pan.value = 0;
            oscillator.type = this.waveform;
            oscillator.frequency.value = 200;
            gainNode.gain.value = 0;
            
            oscillator.connect(gainNode);
            gainNode.connect(panner);
            
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
        this.startSporadicOscillators();
    }
    
    createReverbImpulse() {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * 1.5;
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
        for (let i = 0; i < 8; i++) {
            this.scheduleSporadicPulse(i);
        }
    }
    
    setMode(mode) {
        this.mode = mode;
        this.setWaveform(this.waveform);
        
        this.sporadicTimers.forEach(timer => clearTimeout(timer));
        this.sporadicTimers = [];
        
        for (let i = 0; i < 8; i++) {
            this.scheduleSporadicPulse(i);
        }
    }
    
    setWaveform(waveform) {
        this.waveform = waveform;
        
        this.oscillators.forEach(osc => {
            if (waveform === 'organ') {
                const real = new Float32Array([0, 1.0, 0.7, 0.3, 0.8, 0.2, 0.4, 0.15, 0.6, 0.1, 0.3, 0.08, 0.2, 0.05, 0.15, 0.03, 0.4]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'square') {
                const real = new Float32Array([0, 1.0, 0, 0.333, 0, 0.2, 0, 0.143, 0, 0.111, 0, 0.091, 0, 0.077]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'metallic') {
                const real = new Float32Array([0, 1.0, 0.4, 0.15, 0.3, 0.08, 0.2, 0.06, 0.15, 0.04, 0.1, 0.03, 0.08]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else if (waveform === 'harsh') {
                const real = new Float32Array([0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1]);
                const imag = new Float32Array(real.length);
                const wave = this.audioContext.createPeriodicWave(real, imag);
                osc.setPeriodicWave(wave);
            } else {
                osc.type = waveform;
            }
        });
    }
    
    setScale(scale) {
        this.scale = scale;
        this.updateFrequencies();
    }
    
    scheduleSporadicPulse(oscIndex) {
        const speedNorm = Math.min(this.speed / 35.8, 1);
        let interval, duration, fadeIn, fadeOut;
        
        if (this.mode === 'pulse') {
            duration = 50 + Math.random() * 250;
            fadeIn = (20 + Math.random() * 60) / 1000;
            fadeOut = (10 + Math.random() * 40) / 1000;
            
            if (oscIndex === 3) {
                const minInterval = 12000 - (speedNorm * 8000);
                const maxInterval = 20000 - (speedNorm * 12000);
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                const minInterval = 8000 - (speedNorm * 5000);
                const maxInterval = 15000 - (speedNorm * 8000);
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            }
        } else if (this.mode === 'click') {
            const clickType = Math.random();
            
            if (clickType < 0.5) {
                duration = 0.5 + Math.random() * 2;
                fadeIn = 0.0001;
                fadeOut = 0.0001;
            } else if (clickType < 0.8) {
                duration = 3 + Math.random() * 7;
                fadeIn = 0.0001;
                fadeOut = 0.001;
            } else {
                duration = 10 + Math.random() * 20;
                fadeIn = 0.0001;
                fadeOut = 0.003;
            }
            
            const primeIntervals = [37, 41, 43, 47, 53, 59, 61, 67];
            const baseInterval = primeIntervals[oscIndex] * (40 + speedNorm * 20);
            
            const silenceChance = Math.random();
            const extraSilence = silenceChance > 0.7 ? Math.random() * 10000 : 0;
            
            const jitter = (Math.random() - 0.5) * baseInterval * 0.1;
            interval = baseInterval + jitter + extraSilence;
            
        } else {
            duration = 4000 + Math.random() * 8000;
            fadeIn = 1.0 + Math.random() * 2.0;
            fadeOut = 2.0 + Math.random() * 4.0;
            
            if (oscIndex === 3) {
                const minInterval = 15000 - (speedNorm * 10000);
                const maxInterval = 25000 - (speedNorm * 15000);
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            } else {
                const minInterval = 12000 - (speedNorm * 8000);
                const maxInterval = 20000 - (speedNorm * 12000);
                interval = minInterval + Math.random() * (maxInterval - minInterval);
            }
        }
        
        const timer = setTimeout(() => {
            if (!this.isRunning) return;
            
            if (this.mode === 'click') {
                const now = this.audioContext.currentTime;
                const sampleRate = this.audioContext.sampleRate;
                const bufferLength = Math.ceil(sampleRate * (duration / 1000));
                const buffer = this.audioContext.createBuffer(1, bufferLength, sampleRate);
                const data = buffer.getChannelData(0);
                
                const freq = this.oscillators[oscIndex].frequency.value;
                
                if (freq > 2000) {
                    for (let i = 0; i < bufferLength; i++) {
                        const noise = Math.random() * 2 - 1;
                        data[i] = Math.max(-0.9, Math.min(0.9, noise * 3));
                        data[i] *= Math.exp(-i / (bufferLength * 0.3));
                    }
                } else if (freq > 200) {
                    const cyclesPerSample = freq / sampleRate;
                    for (let i = 0; i < bufferLength; i++) {
                        const sine = Math.sin(2 * Math.PI * cyclesPerSample * i);
                        data[i] = Math.max(-0.7, Math.min(0.7, sine * 5));
                        data[i] *= 1 - (i / bufferLength);
                    }
                } else {
                    const cyclesPerSample = freq / sampleRate;
                    for (let i = 0; i < bufferLength; i++) {
                        const sine = Math.sin(2 * Math.PI * cyclesPerSample * i);
                        data[i] = Math.max(-0.95, Math.min(0.95, sine * 8));
                        data[i] *= Math.exp(-i / (bufferLength * 0.6));
                    }
                }
                
                const source = this.audioContext.createBufferSource();
                const clickGain = this.audioContext.createGain();
                source.buffer = buffer;
                
                let targetVolume;
                if (freq > 2000) {
                    targetVolume = 0.35;
                } else if (freq > 200) {
                    targetVolume = 0.45;
                } else {
                    targetVolume = 0.60;
                }
                
                clickGain.gain.value = targetVolume;
                
                source.connect(clickGain);
                clickGain.connect(this.dryGain);
                clickGain.connect(this.wetGain);
                
                source.start(now);
                
                setTimeout(() => {
                    if (!this.isRunning) return;
                    this.scheduleSporadicPulse(oscIndex);
                }, interval);
                
            } else {
                let targetVolume;
                if (this.mode === 'pulse') {
                    targetVolume = 0.08;
                } else {
                    targetVolume = 0.10;
                }
                
                if (this.mode === 'drone' && oscIndex <= 2) {
                    targetVolume *= 1.15;
                }
                
                if (this.mode === 'drone') {
                    if (oscIndex === 4) targetVolume *= 0.5;
                    else if (oscIndex === 5) targetVolume *= 0.5;
                    else if (oscIndex === 6 || oscIndex === 7) targetVolume *= 0.6;
                }
                
                this.fadeIn(oscIndex, fadeIn, targetVolume);
                
                setTimeout(() => {
                    if (!this.isRunning) return;
                    this.fadeOut(oscIndex, fadeOut);
                    this.scheduleSporadicPulse(oscIndex);
                }, duration);
            }
        }, interval);
        
        this.sporadicTimers.push(timer);
    }
    
    fadeIn(oscIndex, duration, targetVolume) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        
        const irregularity = (Math.random() - 0.5) * 0.02;
        const organicDuration = Math.max(0.01, duration + irregularity);
        const flutter = (Math.random() - 0.5) * 0.001;
        const organicVolume = targetVolume * (1 + flutter);
        const reverseAttackMultiplier = 1 + (1 - this.populationDensity) * 2;
        const finalDuration = organicDuration * reverseAttackMultiplier;
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(organicVolume, now + finalDuration);
    }
    
    fadeOut(oscIndex, duration) {
        if (!this.isRunning || !this.gainNodes[oscIndex]) return;
        const now = this.audioContext.currentTime;
        const gainNode = this.gainNodes[oscIndex];
        
        const ruralCutoff = this.populationDensity < 0.3;
        
        if (ruralCutoff) {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.001);
        } else {
            const irregularity = (Math.random() - 0.5) * 0.02;
            const organicDuration = Math.max(0.01, duration + irregularity);
            const fadeMultiplier = this.populationDensity;
            const finalDuration = organicDuration * fadeMultiplier;
            
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(gainNode.gain.value, now);
            gainNode.gain.linearRampToValueAtTime(0, now + finalDuration);
        }
    }
    
    stop() {
        if (!this.isRunning) return;
        
        this.sporadicTimers.forEach(timer => clearTimeout(timer));
        this.sporadicTimers = [];
        
        if (this.trafficOscillator) {
            try { this.trafficOscillator.stop(); } catch (e) {}
            this.trafficOscillator = null;
            this.trafficGain = null;
        }
        
        this.oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
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
    
    setEnvironmentalData(lat, lon, speed, temp, humidity, heading, timeOfDay, populationDensity = 0.5, trafficDensity = 0.0, elevation = 0, rainfall = 0) {
        this.latitude = lat;
        this.longitude = lon;
        this.speed = speed;
        this.temperature = temp;
        this.humidity = humidity;
        this.heading = heading;
        this.timeOfDay = timeOfDay;
        this.populationDensity = populationDensity;
        this.trafficDensity = trafficDensity;
        this.elevation = elevation;
        this.rainfall = rainfall;
        
        this.updateFrequencies();
    }
    
    calculateSunElevation() {
        const hourAngle = (this.timeOfDay - 0.5) * Math.PI * 2;
        const declination = 0;
        const latRad = this.latitude * Math.PI / 180;
        
        const elevation = Math.asin(
            Math.sin(latRad) * Math.sin(declination) +
            Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle)
        ) * 180 / Math.PI;
        
        return Math.max(-90, Math.min(90, elevation));
    }
    
    updateFrequencies() {
        if (!this.isRunning) return;
        
        const hours = this.timeOfDay * 24;
        
        const tempNorm = (this.temperature + 20) / 60;
        const tempReference = 100 + (tempNorm * 700);
        
        const latNorm = Math.abs(this.latitude) / 90;
        const latOctave = Math.pow(2, latNorm);
        
        const phaseShift = (hours - 12) / 24 * 2 * Math.PI;
        const timeModulation = Math.pow(2, Math.sin(phaseShift) * 0.5);
        
        const densityShift = Math.pow(2, this.populationDensity * 0.5);
        
        const baseFreq = tempReference * latOctave * timeModulation * densityShift;
        
        let fundamentalFreq;
        if (this.mode === 'pulse') {
            fundamentalFreq = baseFreq * (0.5 + Math.random() * 2.5);
        } else if (this.mode === 'click') {
            fundamentalFreq = baseFreq * (0.25 + Math.random() * 8);
        } else {
            fundamentalFreq = baseFreq * (0.75 + Math.random() * 0.5);
        }
        
        this.fundamentalFreq = fundamentalFreq;
        
        const tempDrift = (this.temperature - 20) * 0.5;
        const randomDrift = (Math.random() - 0.5) * Math.abs(tempDrift);
        
        this.sunElevation = this.calculateSunElevation();
        
        const elevationNorm = Math.max(-20, Math.min(70, this.sunElevation));
        const elevationFactor = (elevationNorm + 20) / 90;
        
        const sunBasedLPF = 500 + elevationFactor * 4500;
        const latNormFilter = (this.latitude + 90) / 180;
        const latModulation = latNormFilter * 1000;
        this.lowPassFilter.frequency.value = sunBasedLPF + latModulation;
        
        const sunBasedHPF = 200 - (elevationFactor * 150);
        const lonNorm = (this.longitude + 180) / 360;
        const lonModulation = lonNorm * 50;
        this.highPassFilter.frequency.value = sunBasedHPF + lonModulation;
        
        const compassTones = this.getScaleTones();
        const useSubharmonics = this.fundamentalFreq > 200;
        
        const fund = this.fundamentalFreq + randomDrift;
        this.setOscillatorFrequency(0, fund);
        
        const harmonicIndices = [1, 2, 4, 5, 6, 7];
        
        harmonicIndices.forEach((oscIdx, i) => {
            const tone = compassTones[i % compassTones.length];
            const octaveMultiplier = Math.floor(i / compassTones.length) + 1;
            
            let harmonic;
            if (useSubharmonics) {
                harmonic = fund / (tone * octaveMultiplier);
            } else {
                harmonic = fund * tone * octaveMultiplier;
            }
            
            if (this.mode === 'pulse') {
                if (oscIdx <= 2) {
                    harmonic = harmonic * 0.25;
                } else if (oscIdx >= 5) {
                    harmonic = harmonic * 4.0;
                }
            } else if (this.mode === 'click') {
                if (oscIdx <= 2) {
                    harmonic = harmonic * 0.125;
                } else if (oscIdx >= 5) {
                    harmonic = harmonic * 8.0;
                }
            } else {
                if (oscIdx === 1 || oscIdx === 2) {
                    harmonic = harmonic * 1.0;
                } else if (oscIdx === 6 || oscIdx === 7) {
                    harmonic = harmonic * 8.0;
                } else if (oscIdx === 5) {
                    harmonic = harmonic * 4.0;
                }
            }
            
            this.setOscillatorFrequency(oscIdx, harmonic);
        });
        
        this.lastHeading = this.heading;
        
        const speedNorm = Math.min(this.speed / 35.8, 1);
        let speedFreq = 50 + (speedNorm * 950);
        
        if (this.mode === 'pulse' || this.mode === 'click') {
            if (speedNorm < 0.5) {
                speedFreq = speedFreq * 0.25;
            } else {
                speedFreq = speedFreq * 4.0;
            }
        }
        
        this.setOscillatorFrequency(3, speedFreq);
        
        const humidityNorm = this.humidity / 100;
        this.dryGain.gain.value = 0.85 - (humidityNorm * 0.30);
        this.wetGain.gain.value = 0.15 + (humidityNorm * 0.45);
        
        const headingRad = (this.heading * Math.PI) / 180;
        const panPosition = Math.sin(headingRad) * 0.7;
        
        this.panners.forEach((panner, i) => {
            const densitySpread = 1.0 - (this.populationDensity * 0.7);
            const baseOffset = (i - 3.5) * 0.05;
            const offset = baseOffset * densitySpread;
            const finalPan = Math.max(-0.8, Math.min(0.8, panPosition + offset));
            panner.pan.value = finalPan;
        });
        
        if (this.rainfall > 0) {
            const now = this.audioContext.currentTime;
            const tremoloRate = 4 + (Math.random() * 2);
            const rainfallNorm = Math.min(this.rainfall / 10, 1);
            const tremoloDepth = 0.1 + (rainfallNorm * 0.7);
            
            this.gainNodes.forEach((gainNode) => {
                const currentGain = gainNode.gain.value;
                if (currentGain > 0) {
                    gainNode.gain.cancelScheduledValues(now);
                    gainNode.gain.setValueAtTime(currentGain, now);
                    
                    for (let t = 0; t < 2; t += 0.05) {
                        const phase = t * tremoloRate * Math.PI * 2;
                        const modulation = 1 - (tremoloDepth * 0.5) + (tremoloDepth * 0.5 * Math.sin(phase));
                        gainNode.gain.linearRampToValueAtTime(currentGain * modulation, now + t);
                    }
                }
            });
        }
        
        if (this.onFrequencyUpdate) {
            const freqs = this.oscillators.map(osc => osc.frequency.value);
            this.onFrequencyUpdate(freqs);
        }
    }
    
    getScaleTones() {
        const headingNorm = this.heading % 360;
        let scaleRatios;
        
        switch(this.scale) {
            case 'dreyblatt':
                scaleRatios = [1.0, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875, 2.0, 2.125, 2.25, 2.375, 2.5, 2.625, 2.75, 2.875, 3.0, 3.125, 3.25, 3.375];
                break;
            case 'harmonic':
                scaleRatios = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0, 20.0];
                break;
            case 'slendro':
                const slendroBase = [1.0, 1.2, 1.4, 1.68, 1.87];
                scaleRatios = [...slendroBase, ...slendroBase.map(r => r * 2), ...slendroBase.map(r => r * 3), ...slendroBase.map(r => r * 4)];
                break;
            case 'pelog':
                const pelogBase = [1.0, 1.122, 1.26, 1.414, 1.587, 1.682, 1.888];
                scaleRatios = [...pelogBase, ...pelogBase.map(r => r * 2), ...pelogBase.map(r => r * 3)];
                break;
            case 'quartertone':
                scaleRatios = Array.from({length: 24}, (_, i) => Math.pow(2, i / 24));
                break;
            default:
                scaleRatios = [1.0, 1.125, 1.25, 1.5, 1.75, 2.0];
        }
        
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
    
    setOscillatorFrequency(index, frequency) {
        if (!this.oscillators[index]) return;
        
        const now = this.audioContext.currentTime;
        const osc = this.oscillators[index];
        const organicFreq = frequency;
        
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.exponentialRampToValueAtTime(
            Math.max(20, Math.min(20000, organicFreq)),
            now + 2.0
        );
    }
}