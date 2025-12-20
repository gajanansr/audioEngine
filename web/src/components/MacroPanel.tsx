import './MacroPanel.css';

interface UserMacros {
    autotuneStrength: number;
    reverbAmount: number;
    vocalLoudness: number;
    polishAmount: number;
}

interface MacroPanelProps {
    macros: UserMacros;
    onChange: (name: keyof UserMacros, value: number) => void;
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
            {(Object.keys(MACRO_INFO) as (keyof UserMacros)[]).map((key) => {
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
        </div>
    );
}
