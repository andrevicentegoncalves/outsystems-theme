(function() {
    window.CarouselTabs = (function() {
        const DEFAULT_CONFIG = {
            carouselClass: '.carousel__tabs',
            itemWidth: 210,
            autoplayInterval: 5000,
            pauseOnClick: 9000,
            itemIds: [],
            initialTabIndex: 0,
            onTabChange: null
        };

        const instances = new Map();

        function getSnapPosition(currentPosition, itemWidth, containerWidth, totalWidth) {
            const maxScroll = totalWidth - containerWidth;
            if (currentPosition > -itemWidth / 2) return 0;
            if (currentPosition < -maxScroll + itemWidth / 2) return -maxScroll;
            return Math.round(currentPosition / itemWidth) * itemWidth;
        }

        function initCarouselTabs(userConfig) {
            const config = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
            
            if (config.itemWidth <= 0) {
                config.itemWidth = DEFAULT_CONFIG.itemWidth;
            }
            
            if (config.autoplayInterval < 1000) {
                config.autoplayInterval = 1000;
            }
            
            if (config.pauseOnClick < config.autoplayInterval) {
                config.pauseOnClick = config.autoplayInterval;
            }

            if (instances.has(config.carouselClass)) {
                instances.get(config.carouselClass)();
                instances.delete(config.carouselClass);
            }

            const container = document.querySelector(config.carouselClass);
            if (!container) return function() {};

            const state = {
                autoplayTimer: null,
                pauseTimeout: null,
                resizeTimer: null,
                isDestroyed: false,
                isPaused: false,
                isDraggable: false,
                currentIndex: config.initialTabIndex || 0,
                dragStart: null,
                dragStartTime: null,
                initialOffset: 0,
                currentOffset: 0,
                isDragging: false
            };

            function updatePosition(index, animate = true) {
                if (!state.isDraggable) return;
                
                const tabsList = container.querySelector('.carousel__tabs-list');
                const containerWidth = container.offsetWidth;
                const totalWidth = config.itemIds.length * config.itemWidth;
                let scrollPosition;
                
                if (index === 0) {
                    scrollPosition = 0;
                } else if (index === config.itemIds.length - 1) {
                    scrollPosition = totalWidth - containerWidth;
                } else {
                    scrollPosition = (config.itemWidth * index) - ((containerWidth - config.itemWidth) / 2);
                }
                
                scrollPosition = Math.max(0, Math.min(scrollPosition, totalWidth - containerWidth));
                
                tabsList.style.transition = animate ? 'left 0.3s ease' : 'none';
                tabsList.style.left = `-${scrollPosition}px`;
                state.currentOffset = -scrollPosition;

                container.classList.toggle('at-start', scrollPosition === 0);
                container.classList.toggle('at-end', scrollPosition >= totalWidth - containerWidth);
            }

            function checkDraggable() {
                const tabsList = container.querySelector('.carousel__tabs-list');
                if (!tabsList) return;
                
                const containerWidth = container.offsetWidth;
                const totalContentWidth = config.itemIds.length * config.itemWidth;
                state.isDraggable = totalContentWidth > containerWidth;

                if (!state.isDraggable) {
                    tabsList.style.transition = 'left 0.3s ease';
                    tabsList.style.left = '0px';
                    container.classList.remove('is-draggable');
                    removeDragListeners();
                } else {
                    container.classList.add('is-draggable');
                    addDragListeners();
                    updatePosition(state.currentIndex, false);
                }
            }

            function startAutoplay() {
                if (config.autoplayInterval && !state.isDestroyed) {
                    clearInterval(state.autoplayTimer);
                    state.autoplayTimer = setInterval(function() {
                        if (!state.isPaused && !state.isDestroyed && !state.isDragging) {
                            const nextIndex = (state.currentIndex + 1) % config.itemIds.length;
                            selectTab(nextIndex, false);
                        }
                    }, config.autoplayInterval);
                }
            }

            function pauseAutoplay(duration) {
                clearInterval(state.autoplayTimer);
                clearTimeout(state.pauseTimeout);
                state.isPaused = true;
                
                if (duration) {
                    state.pauseTimeout = setTimeout(function() {
                        if (!state.isDestroyed) {
                            state.isPaused = false;
                            startAutoplay();
                        }
                    }, duration);
                }
            }

            function handleDragStart(e) {
                if (!state.isDraggable || state.isDestroyed) return;
                if (e.type === 'touchstart' && e.touches.length > 1) return;
                
                state.dragStart = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
                state.dragStartTime = Date.now();
                state.isDragging = true;
                
                const tabsList = container.querySelector('.carousel__tabs-list');
                state.initialOffset = parseInt(tabsList.style.left || '0');
                tabsList.style.transition = 'none';
                
                pauseAutoplay(config.pauseOnClick);
                
                e.preventDefault();
            }

            function handleDragMove(e) {
                if (!state.dragStart || state.isDestroyed || !state.isDragging) return;
                if (e.type === 'touchmove' && e.touches.length > 1) return;
                
                e.preventDefault();
                const currentPosition = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
                const offset = currentPosition - state.dragStart;
                
                const tabsList = container.querySelector('.carousel__tabs-list');
                const containerWidth = container.offsetWidth;
                const totalWidth = config.itemIds.length * config.itemWidth;
                
                let newOffset = state.initialOffset + offset;
                const minOffset = -(totalWidth - containerWidth);
                
                if (newOffset > 0) {
                    newOffset = newOffset * 0.3;
                } else if (newOffset < minOffset) {
                    newOffset = minOffset + (newOffset - minOffset) * 0.3;
                }
                
                tabsList.style.transition = 'none';
                tabsList.style.left = `${newOffset}px`;
                state.currentOffset = newOffset;
            }

            function handleDragEnd(e) {
                if (!state.dragStart || state.isDestroyed || !state.isDragging) return;
                
                const finalPosition = e.type === 'mouseup' ? e.clientX : (e.changedTouches ? e.changedTouches[0].clientX : state.dragStart);
                const totalMovement = Math.abs(finalPosition - state.dragStart);
                const dragDuration = Date.now() - state.dragStartTime;
                
                const containerWidth = container.offsetWidth;
                const totalWidth = config.itemIds.length * config.itemWidth;
                const isNearEnd = -state.currentOffset > totalWidth - containerWidth - (config.itemWidth / 2);
                
                if (dragDuration < 300 && totalMovement < 20) {
                    const clickedItem = e.target.closest('.carousel__tabs-item');
                    if (clickedItem) {
                        const items = Array.from(container.querySelectorAll('.carousel__tabs-item'));
                        const clickedIndex = items.indexOf(clickedItem);
                        if (clickedIndex !== -1) {
                            selectTab(clickedIndex, true);
                        }
                    }
                } else {
                    if (isNearEnd) {
                        updatePosition(config.itemIds.length - 1, true);
                    } else {
                        let targetIndex = Math.round(-state.currentOffset / config.itemWidth);
                        targetIndex = Math.max(0, Math.min(targetIndex, config.itemIds.length - 1));
                        updatePosition(targetIndex, true);
                    }
                }
                
                state.isDragging = false;
                state.dragStart = null;
                state.dragStartTime = null;
            }

            function handleResize() {
                if (state.isDestroyed) return;
                
                clearTimeout(state.resizeTimer);
                state.resizeTimer = setTimeout(function() {
                    const items = container.querySelectorAll('.carousel__tabs-item');
                    items.forEach(item => {
                        item.style.width = `${config.itemWidth}px`;
                        item.style.minWidth = `${config.itemWidth}px`;
                        item.style.flex = `0 0 ${config.itemWidth}px`;
                    });
                    checkDraggable();
                    updatePosition(state.currentIndex);
                }, 250);
            }

            function selectTab(index, wasClicked) {
                if (state.isDestroyed || index < 0 || index >= config.itemIds.length) return;
                
                state.currentIndex = index;
                
                const items = container.querySelectorAll('.carousel__tabs-item');
                items.forEach((item, i) => {
                    if (i === index) {
                        item.classList.add('carousel__tabs-item--selected');
                        item.classList.remove('inactive');
                    } else {
                        item.classList.remove('carousel__tabs-item--selected');
                        item.classList.add('inactive');
                    }
                });

                updatePosition(index);

                if (config.onTabChange && config.itemIds[index] !== undefined) {
                    const itemId = config.itemIds[index];
                    config.onTabChange(itemId.toString());
                }

                if (wasClicked) {
                    pauseAutoplay(config.pauseOnClick);
                }
            }

            function addDragListeners() {
                container.addEventListener('mousedown', handleDragStart);
                container.addEventListener('touchstart', handleDragStart, { passive: false });
                container.addEventListener('mousemove', handleDragMove);
                container.addEventListener('touchmove', handleDragMove, { passive: false });
                container.addEventListener('mouseup', handleDragEnd);
                container.addEventListener('mouseleave', handleDragEnd);
                container.addEventListener('touchend', handleDragEnd);
                container.addEventListener('touchcancel', handleDragEnd);
            }

            function removeDragListeners() {
                container.removeEventListener('mousedown', handleDragStart);
                container.removeEventListener('touchstart', handleDragStart);
                container.removeEventListener('mousemove', handleDragMove);
                container.removeEventListener('touchmove', handleDragMove);
                container.removeEventListener('mouseup', handleDragEnd);
                container.removeEventListener('mouseleave', handleDragEnd);
                container.removeEventListener('touchend', handleDragEnd);
                container.removeEventListener('touchcancel', handleDragEnd);
            }

            function cleanup() {
                state.isDestroyed = true;
                clearInterval(state.autoplayTimer);
                clearTimeout(state.pauseTimeout);
                clearTimeout(state.resizeTimer);
                window.removeEventListener('resize', handleResize);
                removeDragListeners();
                instances.delete(config.carouselClass);
            }

            // Initialize
            const items = container.querySelectorAll('.carousel__tabs-item');
            if (items.length > 0) {
                items.forEach(item => {
                    item.style.width = `${config.itemWidth}px`;
                    item.style.minWidth = `${config.itemWidth}px`;
                    item.style.flex = `0 0 ${config.itemWidth}px`;
                });

                window.addEventListener('resize', handleResize);
                checkDraggable();
                selectTab(0, false);
                startAutoplay();

                instances.set(config.carouselClass, cleanup);
                return cleanup;
            }

            return function() {};
        }

        return {
            init: initCarouselTabs,
            destroyAll: function() {
                instances.forEach(cleanup => cleanup());
                instances.clear();
            }
        };
    })();
})();