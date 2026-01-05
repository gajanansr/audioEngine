import { Link } from 'react-router-dom';
import AnimatedHeadphone from '../components/AnimatedHeadphone';
import './Landing.css';

const Landing = () => {
    return (
        <div className="landing">
            {/* Background Elements */}
            <div className="landing-bg">
                <div className="bg-gradient-1"></div>
                <div className="bg-gradient-2"></div>
                <div className="bg-grid"></div>
                <div className="bg-particles">
                    {[...Array(20)].map((_, i) => (
                        <div key={i} className={`particle particle-${i + 1}`}></div>
                    ))}
                </div>
            </div>

            {/* Navigation */}
            <nav className="landing-nav">
                <div className="nav-brand">
                    <span className="brand-name">auto<span className="brand-accent">MIX</span></span>
                </div>
                <div className="nav-links">
                    <a href="#features" className="nav-link">Features</a>
                    <a href="#story" className="nav-link">Dev Story</a>
                    <Link to="/login" className="nav-link nav-cta">Get Started</Link>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="hero">
                <div className="hero-content">
                    <div className="hero-text">
                        <div className="hero-badge">
                            <span className="badge-dot"></span>
                            AI-Powered Audio Mixing
                        </div>
                        <h1 className="hero-title">
                            auto<span className="title-accent">MIX</span>
                        </h1>
                        <p className="hero-tagline">
                            mixing vocals shouldn't cost your dreams.
                        </p>
                        <p className="hero-description">
                            Transform phone-recorded vocals into professional, studio-quality
                            tracks in minutes. No mixing knowledge required. Just your voice
                            and your vision.
                        </p>
                        <div className="hero-actions">
                            <a
                                href="https://www.producthunt.com/products/automix?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-automix"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="product-hunt-badge"
                            >
                                <img
                                    src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1057845&theme=neutral&t=1767644280689"
                                    alt="AutoMIX - Mix your phone recorded vocals with AI and sound like a pro | Product Hunt"
                                    style={{ height: '44px', width: 'auto' }}
                                />
                            </a>
                        </div>
                        <div className="hero-stats">
                            <div className="stat">
                                <span className="stat-number">Faster</span>
                                <span className="stat-label">Than Manual</span>
                            </div>
                            <div className="stat-divider"></div>
                            <div className="stat">
                                <span className="stat-number">Studio Quality</span>
                                <span className="stat-label">From Phone</span>
                            </div>
                            <div className="stat-divider"></div>
                            <div className="stat">
                                <span className="stat-number">Customisable</span>
                                <span className="stat-label">Mixes</span>
                            </div>
                        </div>
                    </div>
                    <div className="hero-visual">
                        <AnimatedHeadphone />
                    </div>
                </div>
                <div className="hero-scroll-indicator">
                    <div className="scroll-line"></div>
                    <span>Scroll to explore</span>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="features">
                <div className="section-header">
                    <span className="section-badge">Features</span>
                    <h2 className="section-title">Everything you need to sound professional</h2>
                    <p className="section-subtitle">
                        Powered by AI trained on millions of professional mixes
                    </p>
                </div>

                <div className="features-grid">
                    <div className="feature-card feature-card-1">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                        </div>
                        <h3 className="feature-title">AI Vocal Processing</h3>
                        <p className="feature-description">
                            Intelligent EQ, compression, and de-essing that adapts to your
                            unique voice. Sound like you recorded in a professional studio.
                        </p>
                        <div className="feature-tags">
                            <span className="feature-tag">Auto-Tune</span>
                            <span className="feature-tag">De-Noise</span>
                            <span className="feature-tag">EQ Match</span>
                        </div>
                    </div>

                    <div className="feature-card feature-card-2">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                                <line x1="8" x2="16" y1="21" y2="21" />
                                <line x1="12" x2="12" y1="17" y2="21" />
                                <path d="m6 8 4 4-4 4" />
                                <line x1="12" x2="18" y1="16" y2="16" />
                            </svg>
                        </div>
                        <h3 className="feature-title">One-Click Mastering</h3>
                        <p className="feature-description">
                            Professional mastering at the push of a button. Get streaming-ready
                            loudness levels without sacrificing dynamics.
                        </p>
                        <div className="feature-tags">
                            <span className="feature-tag">LUFS Targeting</span>
                            <span className="feature-tag">Limiter</span>
                        </div>
                    </div>

                    <div className="feature-card feature-card-3">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                            </svg>
                        </div>
                        <h3 className="feature-title">Genre-Aware Mixing</h3>
                        <p className="feature-description">
                            Whether it's hip-hop, R&B, pop, or indie—our AI understands your
                            genre and applies the perfect processing chain.
                        </p>
                        <div className="feature-tags">
                            <span className="feature-tag">Hip-Hop</span>
                            <span className="feature-tag">R&B</span>
                            <span className="feature-tag">Pop</span>
                            <span className="feature-tag">Indie</span>
                        </div>
                    </div>

                    <div className="feature-card feature-card-4">
                        <div className="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                <path d="m9 12 2 2 4-4" />
                            </svg>
                        </div>
                        <h3 className="feature-title">Phone Recording Ready</h3>
                        <p className="feature-description">
                            Recorded on your iPhone or Android? No problem. Our AI removes
                            room noise and phone artifacts automatically.
                        </p>
                        <div className="feature-tags">
                            <span className="feature-tag">Noise Reduction</span>
                            <span className="feature-tag">Room Correction</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* Story Section */}
            <section id="story" className="story">
                <div className="story-container">
                    <div className="story-visual">
                        <div className="waveform-display">
                            <div className="waveform-before">
                                <span className="waveform-label">Before</span>
                                <div className="waveform-bars">
                                    {[...Array(30)].map((_, i) => (
                                        <div
                                            key={i}
                                            className="wave-bar wave-bar-raw"
                                            style={{
                                                height: `${20 + Math.random() * 30}%`,
                                                animationDelay: `${i * 0.05}s`
                                            }}
                                        ></div>
                                    ))}
                                </div>
                            </div>
                            <div className="waveform-arrow">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </div>
                            <div className="waveform-after">
                                <span className="waveform-label">After</span>
                                <div className="waveform-bars">
                                    {[...Array(30)].map((_, i) => (
                                        <div
                                            key={i}
                                            className="wave-bar wave-bar-mixed"
                                            style={{
                                                height: `${40 + Math.random() * 40}%`,
                                                animationDelay: `${i * 0.05}s`
                                            }}
                                        ></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="story-content">
                        <span className="section-badge">Dev Story</span>
                        <h2 className="story-title">Built by an Artist, For Artists</h2>
                        <p className="story-text">
                            I am Gajanan, an artist who has been there recording vocals under my blanket, struggling
                            with plugins I couldn't afford, and watching tutorials that assumed
                            I had $10,000 worth of gear.
                        </p>
                        <p className="story-text">
                            autoMIX was born from that frustration. I believe every voice
                            deserves to be heard at its best, regardless of budget or technical
                            expertise.
                        </p>
                        <blockquote className="story-quote">
                            <span className="quote-mark">"</span>
                            Your dreams shouldn't be limited by your mixing budget.
                            So, autoMIX is here to level the playing field.
                            <span className="quote-mark">"</span>
                        </blockquote>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="cta">
                <div className="cta-glow"></div>
                <div className="cta-content">
                    <h2 className="cta-title">Ready to sound professional?</h2>
                    <p className="cta-subtitle">
                        Join thousands of artists who've already transformed their sound
                    </p>
                    <Link to="/login" className="btn btn-primary btn-lg cta-btn">
                        Start Your Free Mix
                    </Link>
                    <p className="cta-note">No credit card required • First 3 mixes free</p>
                </div>
            </section>

            {/* Footer */}
            <footer className="landing-footer">
                <div className="footer-content">
                    <div className="footer-brand">
                        <span className="brand-name">auto<span className="brand-accent">MIX</span></span>
                    </div>
                    <p className="footer-tagline">mixing vocals shouldn't cost your dreams.</p>
                    {/* <div className="footer-links">
                        <a href="#" className="footer-link">Privacy</a>
                        <a href="#" className="footer-link">Terms</a>
                        <a href="#" className="footer-link">Support</a>
                    </div> */}
                    <p className="footer-copyright">
                        © 2026 autoMIX. Made with 💜 for independent artists.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
