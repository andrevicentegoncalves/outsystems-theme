const Selectors = {
    container: '.flip__perspective',
    card: '.flip__card',
    inner: '.flip__inner',
    front: '.flip__face--front',
    back: '.flip__face--back',
    wrapper: '.flip__wrapper',
    list: '.flip__list',
    transitionWrapper: '.flip__transition',
    button: '.flip__button',
    flippedClass: 'flip__inner--flipped',
    transitioningClass: 'flip__wrapper--transitioning',
    noFlip: 'no-flip'
};

const Config = {
    heights: {
        minimum: 260,
        mobileMinimum: 310,
        headerImage: 120
    },
    breakpoints: {
        mobile: 768
    },
    timings: {
        transition: 500,
        resizeDebounce: 250,
        visibilityDelay: 100,
        initCheckInterval: 100
    },
    init: {
        maxAttempts: 50
    }
};

function isMobile() {
    return window.innerWidth <= Config.breakpoints.mobile;
}

function getRowCards(container) {
    var rect = container.getBoundingClientRect();
    var rowTop = Math.round(rect.top);
    return Array.from(document.querySelectorAll(Selectors.container))
        .filter(function(card) {
            return Math.round(card.getBoundingClientRect().top) === rowTop;
        });
}

function calculateAndApplyHeights(rowCards) {
    if (isMobile()) {
        rowCards.forEach(function(card) {
            card.style.height = 'auto';
            card.style.minHeight = Config.heights.mobileMinimum + 'px';
        });
        return;
    }

    // Reset heights first
    rowCards.forEach(function(card) {
        var front = card.querySelector(Selectors.front);
        var back = card.querySelector(Selectors.back);
        if (front) front.style.height = 'auto';
        if (back) back.style.height = 'auto';
    });

    // Find max height
    var maxHeight = 0;
    rowCards.forEach(function(card) {
        var inner = card.querySelector(Selectors.inner);
        var isFlipped = inner ? inner.classList.contains(Selectors.flippedClass) : false;
        var visibleFace = isFlipped ? 
            card.querySelector(Selectors.back) : 
            card.querySelector(Selectors.front);

        if (visibleFace) {
            var visibleHeight = visibleFace.scrollHeight;
            maxHeight = Math.max(maxHeight, visibleHeight);
        }
    });

    maxHeight = Math.max(maxHeight, Config.heights.minimum);

    // Apply max height to the card container
    rowCards.forEach(function(card) {
        card.style.height = maxHeight + 'px';
    });
}

window.handleGridFlipButton = function(button) {
    var cardInner = button.closest(Selectors.inner);
    if (!cardInner) return;

    var container = button.closest(Selectors.container);
    if (!container) return;

    // Unflip all other cards first
    document.querySelectorAll(Selectors.inner + '.' + Selectors.flippedClass).forEach(function(inner) {
        if (inner !== cardInner) {
            inner.classList.remove(Selectors.flippedClass);
        }
    });

    var wrapper = document.querySelector(Selectors.wrapper);
    if (wrapper) {
        wrapper.classList.add(Selectors.transitioningClass);
        
        // Get current row cards
        var rowCards = getRowCards(container);
        
        // Toggle the flip
        cardInner.classList.toggle(Selectors.flippedClass);

        // Calculate heights after transition
        setTimeout(function() {
            calculateAndApplyHeights(rowCards);
            wrapper.classList.remove(Selectors.transitioningClass);
        }, Config.timings.transition);
    }
};

function InitGridFlip() {
    // Clean up any existing flip handlers
    const oldInstance = window.flipInstance;
    if (oldInstance && oldInstance.cleanup) {
        oldInstance.cleanup();
    }

    function createTransitionWrappers() {
        var containers = document.querySelectorAll(Selectors.container);
        containers.forEach(function(container) {
            if (!container.closest(Selectors.transitionWrapper)) {
                var wrapper = document.createElement('div');
                wrapper.className = Selectors.transitionWrapper.substring(1);
                container.parentNode.insertBefore(wrapper, container);
                wrapper.appendChild(container);
            }
        });
    }

    function setupHoverEvents() {
        if (isMobile()) return;

        document.querySelectorAll(Selectors.container).forEach(function(container) {
            container.addEventListener('mouseenter', function() {
                if (container.classList.contains(Selectors.noFlip)) return;
                
                var inner = container.querySelector(Selectors.inner);
                if (!inner) return;

                var rowCards = getRowCards(container);
                calculateAndApplyHeights(rowCards);
                inner.classList.add(Selectors.flippedClass);
            });

            container.addEventListener('mouseleave', function() {
                var inner = container.querySelector(Selectors.inner);
                if (!inner) return;

                inner.classList.remove(Selectors.flippedClass);

                var rowCards = getRowCards(container);
                calculateAndApplyHeights(rowCards);

                setTimeout(function() {
                    calculateAndApplyHeights(rowCards);
                }, Config.timings.transition);
            });
        });
    }

    function setupEventListeners() {
        document.querySelectorAll(Selectors.inner).forEach(function(inner) {
            inner.classList.remove(Selectors.flippedClass);
        });

        setupHoverEvents();

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                setTimeout(function() {
                    var containers = document.querySelectorAll(Selectors.container);
                    containers.forEach(function(container) {
                        var rowCards = getRowCards(container);
                        calculateAndApplyHeights(rowCards);
                    });
                }, Config.timings.visibilityDelay);
            }
        });

        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                setupHoverEvents();
                var containers = document.querySelectorAll(Selectors.container);
                containers.forEach(function(container) {
                    var rowCards = getRowCards(container);
                    calculateAndApplyHeights(rowCards);
                });
            }, Config.timings.resizeDebounce);
        });
    }

    // Store the interval so we can clear it later
    let initInterval;

    function init() {
        let attempts = 0;
        initInterval = setInterval(function() {
            attempts++;
            var containers = document.querySelectorAll(Selectors.container);

            if (containers.length > 0) {
                clearInterval(initInterval);
                createTransitionWrappers();
                setupEventListeners();
                containers.forEach(function(container) {
                    var rowCards = getRowCards(container);
                    calculateAndApplyHeights(rowCards);
                });
            } else if (attempts >= Config.init.maxAttempts) {
                clearInterval(initInterval);
            }
        }, Config.timings.initCheckInterval);

        return initInterval;
    }

    window.flipInstance = {
        init: init(),
        cleanup: function() {
            if (initInterval) {
                clearInterval(initInterval);
            }
            // Additional cleanup if needed
        }
    };

    return window.flipInstance;
}

// Run on initial load
function triggerInitGridFlip() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        InitGridFlip();
    } else {
        document.addEventListener('DOMContentLoaded', InitGridFlip);
    }
}

triggerInitGridFlip();

// Run on back navigation
window.addEventListener('pageshow', function(event) {
    if (event.persisted || (window.performance && window.performance.getEntriesByType("navigation")[0].type === 'back_forward')) {
        triggerInitGridFlip();
    }
});

// Also handle History API navigation
window.addEventListener('popstate', function() {
    triggerInitGridFlip();
});