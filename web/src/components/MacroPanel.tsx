import './MacroPanel.css';

interface UserMacros {
    autotuneStrength: number;
    reverbAmount: number;
    vocalLoudness: number;
    polishAmount: number;
    // Backing vocals (V2)
    backingVocalsEnabled?: boolean;
    backingVocalsType?: 'doubles' | 'harmonies' | 'full';
    backingVocalsAmount?: number;
}

interface MacroPanelProps {
    macros: UserMacros;
    onChange: (name: keyof UserMacros, value: number | boolean | string) => void;
}

const MACRO_INFO = {
    autotuneStrength: {
        label: 'AutoTune Strength',
        description: 'How much pitch correction to apply',
        min: 0,
        max: 100,
        unit: '%',
    },
    reverbAmount: {
        label: 'Reverb Amount',
        description: 'Space and depth of the vocal',
        min: 0,
        max: 100,
        unit: '%',
    },
    vocalLoudness: {
        label: 'Vocal Loudness',
        description: 'Relative volume of the vocal',
        min: -12,
        max: 6,
        unit: 'dB',
    },
    polishAmount: {
        label: 'Natural ↔ Polished',
        description: 'From natural to studio-polished sound',
        min: 0,
        max: 100,
        unit: '%',
    },
};

export default function MacroPanel({ macros, onChange }: MacroPanelProps) {
    return (
        <div className="macro-panel">
            {(Object.keys(MACRO_INFO) as (keyof typeof MACRO_INFO)[]).map((key) => {
                const info = MACRO_INFO[key];
                const value = macros[key];

                return (
                    <div key={key} className="macro-control">
                        <div className="macro-header">
                            <label className="macro-label">{info.label}</label>
                            <span className="macro-value">
                                {value}{info.unit}
                            </span>
                        </div>

                        <input
                            type="range"
                            className="slider"
                            min={info.min}
                            max={info.max}
                            value={value}
                            onChange={(e) => onChange(key, parseFloat(e.target.value))}
                        />

                        <p className="macro-description">{info.description}</p>
                    </div>
                );
            })}

            {/* Backing Vocals Section */}
            <div className="backing-vocals-section">
                <div className="section-header">
                    <h3>🎤 Backing Vocals</h3>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={macros.backingVocalsEnabled || false}
                            onChange={(e) => onChange('backingVocalsEnabled', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {macros.backingVocalsEnabled && (
                    <div className="backing-vocals-controls">
                        <div className="macro-control">
                            <label className="macro-label">Type</label>
                            <div className="type-selector">
                                {['doubles', 'harmonies', 'full'].map((type) => (
                                    <button
                                        key={type}
                                        className={`type-btn ${macros.backingVocalsType === type ? 'active' : ''}`}
                                        onClick={() => onChange('backingVocalsType', type)}
                                    >
                                        {type === 'doubles' && '🎙️ Doubles'}
                                        {type === 'harmonies' && '🎵 Harmonies'}
                                        {type === 'full' && '✨ Full'}
                                    </button>
                                ))}
                            </div>
                            <p className="macro-description">
                                {macros.backingVocalsType === 'doubles' && 'Subtle width from detuned copies'}
                                {macros.backingVocalsType === 'harmonies' && 'Pitch-shifted harmony layers'}
                                {macros.backingVocalsType === 'full' && 'Doubles + harmonies for full sound'}
                                {!macros.backingVocalsType && 'Choose a backing vocal style'}
                            </p>
                        </div>

                        <div className="macro-control">
                            <div className="macro-header">
                                <label className="macro-label">Amount</label>
                                <span className="macro-value">{macros.backingVocalsAmount || 0}%</span>
                            </div>
                            <input
                                type="range"
                                className="slider"
                                min={0}
                                max={100}
                                value={macros.backingVocalsAmount || 0}
                                onChange={(e) => onChange('backingVocalsAmount', parseFloat(e.target.value))}
                            />
                            <p className="macro-description">How prominent the backing vocals are</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
