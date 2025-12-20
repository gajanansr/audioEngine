import './PremiumModal.css';

interface PremiumModalProps {
    isOpen: boolean;
    onClose: () => void;
    editCount: number;
}

export default function PremiumModal({ isOpen, onClose, editCount }: PremiumModalProps) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="premium-modal" onClick={e => e.stopPropagation()}>
                <div className="premium-icon">⭐</div>
                <h2>Upgrade to Premium</h2>
                <p className="premium-message">
                    You've used all <strong>3 free edits</strong> for this project.
                </p>
                <p className="premium-subtitle">
                    Unlock unlimited remixes and advanced features with Premium.
                </p>

                <div className="edit-counter">
                    <span className="counter-label">Edits used:</span>
                    <div className="counter-bar">
                        <div className="counter-fill" style={{ width: '100%' }}></div>
                    </div>
                    <span className="counter-value">{editCount}/3</span>
                </div>

                <div className="premium-features">
                    <div className="feature">✓ Unlimited remixes per project</div>
                    <div className="feature">✓ Priority processing</div>
                    <div className="feature">✓ Higher quality exports</div>
                    <div className="feature">✓ Advanced AI controls</div>
                </div>

                <div className="premium-actions">
                    <button className="btn btn-premium" onClick={() => alert('Coming soon!')}>
                        🚀 Upgrade Now
                    </button>
                    <button className="btn btn-secondary" onClick={onClose}>
                        Maybe Later
                    </button>
                </div>
            </div>
        </div>
    );
}
