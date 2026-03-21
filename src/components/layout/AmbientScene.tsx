export default function AmbientScene() {
    return (
        <div className="ambient-scene" aria-hidden="true">
            <div className="ambient-orb ambient-orb-left" />
            <div className="ambient-orb ambient-orb-right" />
            <div className="ambient-ring ambient-ring-top" />
            <div className="ambient-ring ambient-ring-bottom" />
            <div className="ambient-grid-panel ambient-grid-panel-left" />
            <div className="ambient-grid-panel ambient-grid-panel-right" />
            <div className="ambient-cube ambient-cube-left">
                <span />
                <span />
                <span />
            </div>
            <div className="ambient-cube ambient-cube-right">
                <span />
                <span />
                <span />
            </div>
            <div className="ambient-card ambient-card-top" />
            <div className="ambient-card ambient-card-bottom" />
        </div>
    );
}
