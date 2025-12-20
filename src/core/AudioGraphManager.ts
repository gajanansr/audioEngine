import { TrackConfig, ChainParameters, UserMacroState, Genre } from './types';
import { macroController } from '../macros/MacroController';
import { parameterOptimizer } from '../ai/ParameterOptimizer';
import { vocalAnalyzer } from '../ai/VocalAnalyzer';

/**
 * AudioGraphManager
 * Central controller for the entire audio processing graph
 * Manages tracks, routing, processing chains, and rendering
 */
export class AudioGraphManager {
    private context: AudioContext | null = null;
    private offlineContext: OfflineAudioContext | null = null;

    // Nodes
    private masterGain: GainNode | null = null;
    private vocalBusGain: GainNode | null = null;
    private beatGain: GainNode | null = null;

    // Track data
    private tracks: Map<string, TrackConfig> = new Map();
    private chainParameters: ChainParameters | null = null;

    // State
    private isPlaying: boolean = false;
    private currentTime: number = 0;
    private sampleRate: number = 44100;

    /**
     * Initialize the audio context
     */
    async initialize(): Promise<void> {
        this.context = new AudioContext({ sampleRate: this.sampleRate });

        // Create master bus
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);

        // Create vocal bus
        this.vocalBusGain = this.context.createGain();
        this.vocalBusGain.connect(this.masterGain);

        // Create beat bus
        this.beatGain = this.context.createGain();
        this.beatGain.connect(this.masterGain);

        console.log('AudioGraphManager initialized');
    }

    /**
     * Load a vocal track and perform AI analysis
     */
    async loadVocalTrack(file: File): Promise<{
        trackId: string;
        analysis: any;
        parameters: ChainParameters;
    }> {
        if (!this.context) {
            throw new Error('AudioContext not initialized');
        }

        // Decode audio file
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

        // Generate track ID
        const trackId = `vocal_${Date.now()}`;

        // Analyze vocal
        console.log('Analyzing vocal...');
        const analysis = await vocalAnalyzer.analyze(audioBuffer);

        // Generate optimal parameters
        console.log('Optimizing parameters...');
        const parameters = parameterOptimizer.optimizeChain(
            analysis,
            null, // No reference yet
            'default'
        );

        // Store track
        this.tracks.set(trackId, {
            id: trackId,
            name: file.name,
            type: 'vocal',
            audioBuffer,
            chain: parameters
        });

        this.chainParameters = parameters;

        return { trackId, analysis, parameters };
    }

    /**
     * Load a beat/instrumental track
     */
    async loadBeatTrack(file: File): Promise<string> {
        if (!this.context) {
            throw new Error('AudioContext not initialized');
        }

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

        const trackId = `beat_${Date.now()}`;

        this.tracks.set(trackId, {
            id: trackId,
            name: file.name,
            type: 'beat',
            audioBuffer,
            chain: null
        });

        return trackId;
    }

    /**
     * Load and analyze a reference track
     */
    async loadReferenceTrack(file: File, vocalTrackId: string): Promise<void> {
        if (!this.context) {
            throw new Error('AudioContext not initialized');
        }

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

        // Analyze reference
        // In production, use a dedicated ReferenceAnalyzer
        console.log('Analyzing reference track...');

        // Re-optimize vocal parameters with reference
        const vocalTrack = this.tracks.get(vocalTrackId);
        if (vocalTrack && vocalTrack.audioBuffer) {
            const vocalAnalysis = await vocalAnalyzer.analyze(vocalTrack.audioBuffer);

            // Create mock reference analysis for now
            // In production, implement full ReferenceAnalyzer
            const referenceAnalysis = {
                vocalTonalCurve: new Float32Array(2048),
                perceivedReverbSpace: {
                    type: 'plate' as const,
                    preDelay: 50,
                    decay: 2.0,
                    damping: 0.5,
                    wetLevel: 20
                },
                vocalLoudnessBalance: -6,
                overallLoudness: -14
            };

            const newParams = parameterOptimizer.optimizeChain(
                vocalAnalysis,
                referenceAnalysis,
                'default'
            );

            vocalTrack.chain = newParams;
            this.chainParameters = newParams;
        }
    }

    /**
     * Apply user macro changes
     */
    applyMacros(macros: UserMacroState): void {
        macroController.applyAllMacros(macros);
    }

    /**
     * Set genre for parameter optimization
     */
    async setGenre(genre: Genre, vocalTrackId: string): Promise<ChainParameters | null> {
        const vocalTrack = this.tracks.get(vocalTrackId);
        if (!vocalTrack || !vocalTrack.audioBuffer) {
            return null;
        }

        const analysis = await vocalAnalyzer.analyze(vocalTrack.audioBuffer);
        const newParams = parameterOptimizer.optimizeChain(analysis, null, genre);

        vocalTrack.chain = newParams;
        this.chainParameters = newParams;

        return newParams;
    }

    /**
     * Render final mix offline (high quality)
     */
    async renderOffline(
        vocalTrackId: string,
        beatTrackId: string | null,
        duration: number
    ): Promise<AudioBuffer> {
        const vocalTrack = this.tracks.get(vocalTrackId);
        const beatTrack = beatTrackId ? this.tracks.get(beatTrackId) : null;

        if (!vocalTrack?.audioBuffer) {
            throw new Error('Vocal track not loaded');
        }

        // Create offline context
        const channels = 2;
        const sampleRate = this.sampleRate;
        const length = Math.ceil(duration * sampleRate);

        this.offlineContext = new OfflineAudioContext(channels, length, sampleRate);

        // In production, this would apply the full processing chain
        // For now, create a simple mix

        // Vocal source
        const vocalSource = this.offlineContext.createBufferSource();
        vocalSource.buffer = vocalTrack.audioBuffer;

        const vocalGain = this.offlineContext.createGain();
        vocalGain.gain.value = 1.0;

        vocalSource.connect(vocalGain);
        vocalGain.connect(this.offlineContext.destination);

        // Beat source (if provided)
        if (beatTrack?.audioBuffer) {
            const beatSource = this.offlineContext.createBufferSource();
            beatSource.buffer = beatTrack.audioBuffer;

            const beatGainNode = this.offlineContext.createGain();
            beatGainNode.gain.value = 0.8; // Slightly lower than vocal

            beatSource.connect(beatGainNode);
            beatGainNode.connect(this.offlineContext.destination);

            beatSource.start(0);
        }

        vocalSource.start(0);

        // Render
        console.log('Rendering offline...');
        const renderedBuffer = await this.offlineContext.startRendering();
        console.log('Render complete');

        return renderedBuffer;
    }

    /**
     * Export rendered buffer as WAV file
     */
    exportAsWav(buffer: AudioBuffer): Blob {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitsPerSample = 16;

        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;

        const dataLength = buffer.length * blockAlign;
        const bufferLength = 44 + dataLength;

        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);

        // WAV header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, bufferLength - 8, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        // Interleave and write audio data
        const offset = 44;
        const channels: Float32Array[] = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        let pos = offset;
        for (let i = 0; i < buffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));
                const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, intSample, true);
                pos += 2;
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    private writeString(view: DataView, offset: number, string: string): void {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Get current chain parameters
     */
    getChainParameters(): ChainParameters | null {
        return this.chainParameters;
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        if (this.context) {
            this.context.close();
            this.context = null;
        }
        this.tracks.clear();
        this.chainParameters = null;
    }
}

// Export singleton
export const audioGraphManager = new AudioGraphManager();
