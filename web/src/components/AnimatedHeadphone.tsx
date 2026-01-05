import './AnimatedHeadphone.css';

const AnimatedHeadphone = () => {
    return (
        <div className="headphone-container">
            {/* Glow effect layers */}
            <div className="headphone-glow headphone-glow-1"></div>
            <div className="headphone-glow headphone-glow-2"></div>

            {/* Sound wave rings */}
            <div className="sound-rings">
                <div className="sound-ring sound-ring-1"></div>
                <div className="sound-ring sound-ring-2"></div>
                <div className="sound-ring sound-ring-3"></div>
            </div>

            {/* Main SVG Headphone */}
            <svg
                viewBox="0 0 200 200"
                className="headphone-svg"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    {/* Gradient for headphone */}
                    <linearGradient id="headphoneGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="50%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#a855f7" />
                    </linearGradient>

                    {/* Metallic gradient for band */}
                    <linearGradient id="metallicGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#4a4a5a" />
                        <stop offset="50%" stopColor="#2a2a35" />
                        <stop offset="100%" stopColor="#1a1a25" />
                    </linearGradient>

                    {/* Glow filter */}
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    {/* Inner shadow */}
                    <filter id="innerShadow">
                        <feOffset dx="0" dy="2" />
                        <feGaussianBlur stdDeviation="2" result="offset-blur" />
                        <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
                        <feFlood floodColor="black" floodOpacity="0.3" result="color" />
                        <feComposite operator="in" in="color" in2="inverse" result="shadow" />
                        <feComposite operator="over" in="shadow" in2="SourceGraphic" />
                    </filter>
                </defs>

                {/* Headband */}
                <path
                    d="M 40 100 Q 40 40, 100 35 Q 160 40, 160 100"
                    fill="none"
                    stroke="url(#metallicGradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    className="headband"
                />

                {/* Headband highlight */}
                <path
                    d="M 45 98 Q 45 48, 100 43 Q 155 48, 155 98"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="2"
                    strokeLinecap="round"
                />

                {/* Left ear cup connector */}
                <rect
                    x="32"
                    y="90"
                    width="12"
                    height="30"
                    rx="4"
                    fill="url(#metallicGradient)"
                />

                {/* Right ear cup connector */}
                <rect
                    x="156"
                    y="90"
                    width="12"
                    height="30"
                    rx="4"
                    fill="url(#metallicGradient)"
                />

                {/* Left ear cup - outer */}
                <ellipse
                    cx="38"
                    cy="135"
                    rx="28"
                    ry="38"
                    fill="url(#headphoneGradient)"
                    filter="url(#glow)"
                    className="ear-cup left-cup"
                />

                {/* Left ear cup - inner cushion */}
                <ellipse
                    cx="38"
                    cy="135"
                    rx="20"
                    ry="28"
                    fill="#1a1a25"
                    filter="url(#innerShadow)"
                />

                {/* Left ear cup - speaker */}
                <ellipse
                    cx="38"
                    cy="135"
                    rx="12"
                    ry="16"
                    fill="#0a0a0f"
                />

                {/* Left speaker mesh pattern */}
                <g className="speaker-mesh left-mesh">
                    <circle cx="38" cy="130" r="2" fill="#2a2a35" />
                    <circle cx="33" cy="135" r="2" fill="#2a2a35" />
                    <circle cx="43" cy="135" r="2" fill="#2a2a35" />
                    <circle cx="38" cy="140" r="2" fill="#2a2a35" />
                </g>

                {/* Right ear cup - outer */}
                <ellipse
                    cx="162"
                    cy="135"
                    rx="28"
                    ry="38"
                    fill="url(#headphoneGradient)"
                    filter="url(#glow)"
                    className="ear-cup right-cup"
                />

                {/* Right ear cup - inner cushion */}
                <ellipse
                    cx="162"
                    cy="135"
                    rx="20"
                    ry="28"
                    fill="#1a1a25"
                    filter="url(#innerShadow)"
                />

                {/* Right ear cup - speaker */}
                <ellipse
                    cx="162"
                    cy="135"
                    rx="12"
                    ry="16"
                    fill="#0a0a0f"
                />

                {/* Right speaker mesh pattern */}
                <g className="speaker-mesh right-mesh">
                    <circle cx="162" cy="130" r="2" fill="#2a2a35" />
                    <circle cx="157" cy="135" r="2" fill="#2a2a35" />
                    <circle cx="167" cy="135" r="2" fill="#2a2a35" />
                    <circle cx="162" cy="140" r="2" fill="#2a2a35" />
                </g>

                {/* Accent lighting on ear cups */}
                <ellipse
                    cx="30"
                    cy="120"
                    rx="6"
                    ry="10"
                    fill="rgba(255,255,255,0.15)"
                    className="cup-highlight"
                />
                <ellipse
                    cx="154"
                    cy="120"
                    rx="6"
                    ry="10"
                    fill="rgba(255,255,255,0.15)"
                    className="cup-highlight"
                />
            </svg>

            {/* Floating music notes */}
            <div className="music-notes">
                <span className="note note-1">♪</span>
                <span className="note note-2">♫</span>
                <span className="note note-3">♪</span>
            </div>
        </div>
    );
};

export default AnimatedHeadphone;
