import re

with open("src/components/whiteboard/WhiteboardWorkspace.tsx", "r") as f:
    content = f.read()

# PART 1: Replace from Bottom-Left Dock to beginning of showDock
part1_regex = r"\{\/\* Bottom-Left Menu Mini Dock \*\/\}.*?(?=\{\/\* Popups Area - Centered above dock \*\/\})"
part1_replacement = """{/* Unified Bottom Docks */}
            <div className={`fixed bottom-3 left-4 right-4 z-40 flex items-end justify-between pointer-events-none gap-4 transition-transform duration-300 ${isImmersiveMode && !showDock ? "translate-y-32" : "translate-y-0"}`}>
                
                {/* Left Dock Area */}
                <div className="flex-1 flex justify-start">
                    <div className={`flex flex-row items-center gap-1 px-3 py-2 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl pointer-events-auto transition-opacity duration-300 ${isImmersiveMode && !showDock ? "opacity-0" : "opacity-100"}`}>
                        <button
                            onClick={() => setShowMenuPanel(prev => !prev)}
                            className={`btn p-2 rounded-xl flex flex-col items-center justify-center gap-1 min-w-[64px] transition-colors ${showMenuPanel ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-white'}`}
                            title="Menu"
                        >
                            <Menu className="h-5 w-5" />
                            <span className="text-[10px] font-bold tracking-wider uppercase opacity-90">Menu</span>
                        </button>
                    </div>
                </div>

                {/* Center Dock Area */}
                <div className="shrink-0 flex justify-center pointer-events-none">
                    {showDock && (
                        <div
                            ref={dockRef}
                            className={`w-fit max-w-[calc(100vw-220px)] sm:max-w-[calc(100vw-360px)] flex flex-col items-center transition-opacity duration-300 ${isImmersiveMode ? "[&_.btn]:min-h-10 [&_.btn]:px-3 [&_.btn]:text-sm" : ""} ${!showDock ? 'opacity-0' : 'opacity-100'}`}
                        >
                            <div className="flex flex-col gap-2 relative">
                                """
content = re.sub(part1_regex, part1_replacement, content, flags=re.DOTALL)

# PART 2: Replace from end of showDock to the closing div
part2_regex = r"(\s+</div>\n\s+</div>\n\s+\)\s*:\s*\(\n\s+<button\n\s+onClick=\{\(\) => setShowDock\(true\)\}\n\s+className=\"absolute bottom-4 right-4 z-40 btn btn-primary w-12 h-12 rounded-full p-0 flex items-center justify-center shadow-lg hover:scale-105 transition-transform\"\n\s+title=\"Show Dock\"\n\s+>\n\s+<Menu className=\"h-6 w-6\" />\n\s+</button>\n\s+\))"
part2_replacement = """
                        </div>
                    )}
                </div>

                {/* Right Dock Area */}
                <div className="flex-1 flex justify-end">
                    <div className={`flex flex-row items-center gap-1 px-3 py-2 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl pointer-events-auto transition-opacity duration-300 ${isImmersiveMode && !showDock ? "opacity-0" : "opacity-100"}`}>
                        <button
                            onClick={() => changePage(pageNumber - 1, 'prev')}
                            disabled={pageNumber <= 1}
                            className={`btn p-2 rounded-xl flex flex-col items-center justify-center gap-1 min-w-[56px] transition-colors ${pageNumber <= 1 ? "opacity-40 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`}
                            title="Previous Slide"
                        >
                            <ChevronLeft className="h-5 w-5" />
                            <span className="text-[10px] font-bold tracking-wider uppercase opacity-90">Prev</span>
                        </button>
                        <div className="w-px h-8 bg-slate-700 mx-1"></div>
                        <button
                            onClick={() => setShowPagesPanel(prev => !prev)}
                            className={`btn btn-ghost px-3 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${showPagesPanel ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-white'}`}
                            title={showPagesPanel ? "Hide Pages" : "Show Pages"}
                        >
                            <span className="text-[12px] font-bold">{pageNumber} <span className="text-slate-500 mx-0.5">/</span> {numPages || 0}</span>
                            <span className="text-[8px] font-bold tracking-widest uppercase text-slate-400">Pages</span>
                        </button>
                        <div className="w-px h-8 bg-slate-700 mx-1"></div>
                        <button
                            onClick={() => changePage(pageNumber + 1, 'next')}
                            disabled={pageNumber >= (numPages || 1)}
                            className={`btn p-2 rounded-xl flex flex-col items-center justify-center gap-1 min-w-[56px] transition-colors ${pageNumber >= (numPages || 1) ? "opacity-40 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`}
                            title="Next Slide"
                        >
                            <ChevronRight className="h-5 w-5" />
                            <span className="text-[10px] font-bold tracking-wider uppercase opacity-90">Next</span>
                        </button>
                    </div>
                </div>
            </div>

            {!showDock && (
                <button
                    onClick={() => setShowDock(true)}
                    className="absolute bottom-4 right-4 z-40 btn btn-primary w-12 h-12 rounded-full p-0 flex items-center justify-center shadow-lg hover:scale-105 transition-transform pointer-events-auto"
                    title="Show Dock"
                >
                    <Menu className="h-6 w-6" />
                </button>
            )"""
content = re.sub(part2_regex, part2_replacement, content, flags=re.DOTALL)

with open("src/components/whiteboard/WhiteboardWorkspace.tsx", "w") as f:
    f.write(content)
