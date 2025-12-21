/**
 * Section Detector Module
 * 
 * Detects song sections (chorus, verse, bridge) based on energy patterns
 * For now uses energy analysis; later will be replaced by DAW interface markers
 */

export interface SongSection {
    start: number;      // Sample index
    end: number;        // Sample index
    type: 'verse' | 'chorus' | 'bridge' | 'intro' | 'outro';
    energy: number;     // 0-1 normalized energy
    isRepeat: boolean;  // If this section's audio repeats elsewhere
}

export class SectionDetector {
    private sampleRate: number;
    private frameSize: number;
    private hopSize: number;

    constructor(sampleRate: number = 44100) {
        this.sampleRate = sampleRate;
        this.frameSize = Math.floor(sampleRate * 2); // 2 second frames
        this.hopSize = Math.floor(sampleRate * 0.5); // 0.5 second hop
    }

    /**
     * Detect sections in audio based on energy patterns
     * Chorus = high energy, Verse = lower energy
     */
    detect(audio: Float32Array): SongSection[] {
        console.log('   → Analyzing song sections...');

        // Calculate energy envelope
        const energyEnvelope = this.calculateEnergyEnvelope(audio);

        // Find energy threshold (chorus vs verse)
        const { highThreshold, lowThreshold } = this.findThresholds(energyEnvelope);

        // Segment into sections
        const sections = this.segmentByEnergy(
            audio,
            energyEnvelope,
            highThreshold,
            lowThreshold
        );

        // Merge short adjacent sections of same type
        const mergedSections = this.mergeSections(sections);

        console.log(`   → Detected ${mergedSections.length} sections:`);
        for (const s of mergedSections) {
            const startSec = (s.start / this.sampleRate).toFixed(1);
            const endSec = (s.end / this.sampleRate).toFixed(1);
            console.log(`     • ${s.type.toUpperCase()}: ${startSec}s - ${endSec}s (energy: ${(s.energy * 100).toFixed(0)}%)`);
        }

        return mergedSections;
    }

    /**
     * Calculate RMS energy envelope
     */
    private calculateEnergyEnvelope(audio: Float32Array): Float32Array {
        const numFrames = Math.floor((audio.length - this.frameSize) / this.hopSize) + 1;
        const envelope = new Float32Array(numFrames);

        for (let i = 0; i < numFrames; i++) {
            const start = i * this.hopSize;
            let sum = 0;
            for (let j = 0; j < this.frameSize && start + j < audio.length; j++) {
                sum += audio[start + j] * audio[start + j];
            }
            envelope[i] = Math.sqrt(sum / this.frameSize);
        }

        // Normalize
        const maxEnergy = Math.max(...envelope);
        if (maxEnergy > 0) {
            for (let i = 0; i < envelope.length; i++) {
                envelope[i] /= maxEnergy;
            }
        }

        return envelope;
    }

    /**
     * Find thresholds for chorus/verse classification
     */
    private findThresholds(envelope: Float32Array): { highThreshold: number; lowThreshold: number } {
        const sorted = [...envelope].sort((a, b) => a - b);
        const p25 = sorted[Math.floor(sorted.length * 0.25)];
        const p75 = sorted[Math.floor(sorted.length * 0.75)];

        return {
            lowThreshold: p25 + (p75 - p25) * 0.3,
            highThreshold: p25 + (p75 - p25) * 0.6
        };
    }

    /**
     * Segment audio by energy levels
     */
    private segmentByEnergy(
        audio: Float32Array,
        envelope: Float32Array,
        highThreshold: number,
        lowThreshold: number
    ): SongSection[] {
        const sections: SongSection[] = [];
        let currentType: 'verse' | 'chorus' = 'verse';
        let sectionStart = 0;
        let sectionEnergy = 0;
        let frameCount = 0;

        for (let i = 0; i < envelope.length; i++) {
            const energy = envelope[i];
            let newType: 'verse' | 'chorus' = currentType;

            if (energy > highThreshold) {
                newType = 'chorus';
            } else if (energy < lowThreshold) {
                newType = 'verse';
            }

            if (newType !== currentType && i > 0) {
                // Save current section
                sections.push({
                    start: sectionStart,
                    end: i * this.hopSize,
                    type: currentType,
                    energy: frameCount > 0 ? sectionEnergy / frameCount : 0,
                    isRepeat: false
                });

                sectionStart = i * this.hopSize;
                sectionEnergy = 0;
                frameCount = 0;
            }

            sectionEnergy += energy;
            frameCount++;
            currentType = newType;
        }

        // Add final section
        if (frameCount > 0) {
            sections.push({
                start: sectionStart,
                end: audio.length,
                type: currentType,
                energy: sectionEnergy / frameCount,
                isRepeat: false
            });
        }

        return sections;
    }

    /**
     * Merge short adjacent sections of the same type
     */
    private mergeSections(sections: SongSection[]): SongSection[] {
        if (sections.length < 2) return sections;

        const minSectionLength = this.sampleRate * 4; // Minimum 4 seconds
        const merged: SongSection[] = [];

        for (const section of sections) {
            const duration = section.end - section.start;

            if (merged.length === 0) {
                merged.push(section);
                continue;
            }

            const last = merged[merged.length - 1];

            // Merge short sections with adjacent same-type sections
            if (
                (duration < minSectionLength && last.type === section.type) ||
                (section.end - last.start < minSectionLength * 1.5)
            ) {
                last.end = section.end;
                last.energy = (last.energy + section.energy) / 2;
            } else {
                merged.push(section);
            }
        }

        // Handle intro/outro
        if (merged.length > 0) {
            const first = merged[0];
            if (first.end - first.start < this.sampleRate * 6 && first.energy < 0.4) {
                first.type = 'intro' as any;
            }

            const last = merged[merged.length - 1];
            if (last.end - last.start < this.sampleRate * 6 && last.energy < 0.4) {
                last.type = 'outro' as any;
            }
        }

        return merged;
    }

    /**
     * Check if a sample position is within a chorus section
     */
    isChorus(sections: SongSection[], sampleIndex: number): boolean {
        for (const section of sections) {
            if (sampleIndex >= section.start && sampleIndex < section.end) {
                return section.type === 'chorus';
            }
        }
        return false;
    }

    /**
     * Create a mask array where 1 = chorus, 0 = verse
     */
    createChorusMask(sections: SongSection[], audioLength: number): Float32Array {
        const mask = new Float32Array(audioLength);

        for (const section of sections) {
            if (section.type === 'chorus') {
                // Apply soft fade at boundaries (100ms)
                const fadeLength = Math.floor(this.sampleRate * 0.1);

                for (let i = section.start; i < section.end && i < audioLength; i++) {
                    let gain = 1;

                    // Fade in
                    if (i - section.start < fadeLength) {
                        gain = (i - section.start) / fadeLength;
                    }
                    // Fade out
                    if (section.end - i < fadeLength) {
                        gain = (section.end - i) / fadeLength;
                    }

                    mask[i] = gain;
                }
            }
        }

        return mask;
    }
}

export const sectionDetector = new SectionDetector();
