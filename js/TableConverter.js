window.TableConverter = {
    
    // 1. Configuration and State Properties
        debug: true,                            // Enables debug logging
        logEvents: false,                        // Enables logging of events
        debugHtmlLogging: false,                // Enables logging of HTML processing
        initialized: false,                     // Indicates if the converter has been initialized
        observer: null,                         // Mutation observer for monitoring DOM changes
        touchStartX: null,                      // X-coordinate for touch start (for swipe detection)
        touchEndX: null,                        // X-coordinate for touch end (for swipe detection)
        touchThreshold: 50,                     // Threshold for touch swipe detection
        mobileBreakpoint: 1054,                  // Breakpoint for mobile view
        isMobileView: false,                    // Check viewport for mobile view
        mediaQuery: null,                       // Media query object for responsive handling
        converted: new WeakMap(),               // Tracks converted tables
        originalTables: new WeakMap(),          // Tracks original tables for restoration
        originalHtmlContent: null,              // Stores the original HTML content for restoration
        selectors: {
            parentContainer: '.html-wrapper .cke_contents_ltr',
            responsiveContainer: '.responsive-table-container',
            accordion: {
                trigger: '[data-accordion-trigger]',
                content: '.expanded-content',
                active: '.active'
            },
            carousel: {
                container: '[data-carousel]',
                track: '[data-carousel-track]',
                slide: '[data-carousel-slide]',
                prev: '[data-carousel-prev]',
                next: '[data-carousel-next]',
                dot: '[data-carousel-dot]'
            },
            collapse: {
                button: '.collapse__button',
                container: '.collapse__container',
                active: '.active'
            }
        },
        validMarkers: [                         // List of valid markers for table conversion
            'mobile-accordion', 
            'mobile-carousel', 
            'mobile-list', 
            'mobile-list-like-accordion',
            'table-accordion', 
            'table-carousel', 
            'table-list', 
            'table-list-like-accordion'
        ],
        DEFAULT_STATE: {                        // Default state for table processing
            needsAccordion: false,
            needsCarousel: false,
            needsList: false
        },


    // 2. Logging Methodsc
        log: function(...args) {
            if (this.debug) {
                console.log('%c[TableConverter Internal]', 'color: #72BE44; font-weight: bold;', ...args);
            }
        },
        
        logHtml: function(htmlString, isInput = true) {
            if (this.debugHtmlLogging) {
                const type = isInput ? 'Input HTML:' : 'Processed HTML:';
                console.log(`%c[TableConverter Internal] ${type}`, 'color: #72BE44; font-weight: bold;', htmlString);
            }
        },

        logEvent: function(...args) {
            if (this.logEvents) {
                console.log('%c[TableConverter Event]', 'color: #FF5733; font-weight: bold;', ...args);
            }
        },


    // 3. Core Utility Methods
        cleanText: function(text) {
            return text
                .replace(/\s+/g, ' ')    // Replaces multiple whitespace characters with a single space
                .replace(/\n/g, ' ')     // Replaces newline characters with a space
                .replace(/&nbsp;/g, ' ') // Replaces non-breaking space HTML entity with a space
                .trim();                 // Removes leading and trailing whitespace
        },
        
        filterEmptyParagraphs: function(paragraphs) {
            return paragraphs.filter(p => {
                const cleaned = p.replace(/&nbsp;/g, '').trim();
                return cleaned !== '' && cleaned !== '<br>' && cleaned !== '<br/>';
            });
        },

        getDefaultState: function() {
            return { ...this.DEFAULT_STATE };
        },

        isTableProcessed: function(table) {
            return this.converted.has(table);
        },

        bindEvents: function(element, eventType, handler) {
            if (!element || !eventType || !handler) {
                this.log('Error binding event: Missing required parameters', { element, eventType });
                return;
            }
            
            try {
                // Remove existing listeners first
                this.removeEventListeners(element);
                
                // Ensure handler is properly bound to TableConverter context
                const boundHandler = handler.bind(this);
                
                // Store bound handler reference
                element._boundHandlers = element._boundHandlers || {};
                element._boundHandlers[eventType] = boundHandler;
                
                // Add event listener
                element.addEventListener(eventType, boundHandler);
                
                this.log('Event bound successfully', { 
                    element: element.tagName,
                    eventType,
                    handlerName: handler.name
                });
            } catch (error) {
                this.log('Error binding event:', error);
            }
        },

        removeEventListeners: function(container) {
            if (!container) return;
            
            try {
                const elements = container.querySelectorAll(
                    '[data-accordion-trigger], ' +
                    '[data-carousel], ' +
                    '.collapse__button, ' +
                    '[data-carousel-prev], ' +
                    '[data-carousel-next], ' +
                    '[data-carousel-dot]'
                );
                
                elements.forEach(element => {
                    if (element._boundHandlers) {
                        Object.entries(element._boundHandlers).forEach(([eventType, handler]) => {
                            element.removeEventListener(eventType, handler);
                        });
                        delete element._boundHandlers;
                    }
                });
                
                this.log('Event listeners removed successfully');
            } catch (error) {
                this.log('Error removing event listeners:', error);
            }
        },

        cleanup: function () {
            this.log('Starting cleanup process');
        
            try {
                // Remove event listeners
                this.removeAllEventListeners();
                this.log('Event listeners removed during cleanup');
        
                // Disconnect observer
                if (this.observer) {
                    this.observer.disconnect();
                    this.observer = null;
                    this.log('Observer disconnected');
                }
        
                // Reset all state
                this.converted = new WeakMap();
                this.originalTables = new WeakMap();
                this.originalHtmlContent = null;
                this.initialized = false;
                this._isMobileView = null;
        
                this.log('Cleanup completed - all state reset');
            } catch (error) {
                this.log('Error during cleanup:', error);
            }
        },
        
        hasComplexRowspans: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            
            // Count rows with different structures
            let rowspanRows = 0;
            let regularRows = 0;
            let wideRows = 0;
        
            rows.forEach(row => {
                if (row.querySelector('td[rowspan], th[rowspan]')) {
                    rowspanRows++;
                } else if (row.querySelector('td[colspan="3"], td[colspan="4"], th[colspan="3"], th[colspan="4"]')) {
                    wideRows++;
                } else {
                    regularRows++;
                }
            });
        
            // Table is complex if it mixes different row structures
            return (rowspanRows > 0 && regularRows > 0) || 
                   (wideRows > 0 && (rowspanRows > 0 || regularRows > 0));
        },


    // 4. Table Processing
        process: function(htmlString) {
            try {
                const container = document.querySelector(this.selectors.parentContainer);
                
                // Only store original HTML if not already stored and we have a container
                if (!this.originalHtmlContent && container) {
                    this.originalHtmlContent = container.innerHTML;
                    this.log('Original HTML stored', { length: this.originalHtmlContent.length });
                }
        
                // Don't process if we're in desktop mode
                if (!this._isMobileView) {
                    this.log('Desktop mode - skipping table conversion');
                    return htmlString;
                }
        
                this.log('Mobile mode - converting tables');
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlString;
        
                const state = this.getDefaultState();
                this.processMarkers(tempDiv, state);
                
                return tempDiv.innerHTML;
            } catch(error) {
                console.error('[TableConverter] Processing error:', error);
                return htmlString;
            }
        },

        processTable: function(table, marker) {
            this.log('Starting table processing', {
                hasTable: !!table,
                hasMarker: !!marker,
                isMobileView: this.isMobileView(),
                hasParent: !!table?.parentNode,
                noConversion: table.hasAttribute('data-no-conversion')
            });
        
            if (!table || !marker || !this.isMobileView() || !table.parentNode) {
                this.log('Table processing skipped - missing requirements');
                return null;
            }
        
            // Skip conversion if table is marked for no conversion
            if (table.hasAttribute('data-no-conversion')) {
                this.log('Table processing skipped - mobile-no-conversion marker');
                return null;
            }
        
            try {
                const markerType = marker.textContent.trim().toLowerCase();
                this.log('Processing table with marker:', markerType);
                
                const state = this.getDefaultState();
                this.storeOriginalTable(table);
                const convertedHtml = this.convertTableByMarkerType(table, markerType, state);
                    
                if (!convertedHtml) {
                    this.log('No HTML generated from conversion');
                    return null;
                }
        
                const container = document.createElement('div');
                container.className = 'responsive-table-container';
                container.innerHTML = convertedHtml;
        
                table.parentNode.replaceChild(container, table);
                this.converted.set(table, true);
        
                this.log('Table successfully converted');
                return { container, state };
            } catch (error) {
                this.log('Error during table processing:', error);
                return null;
            }
        },

        processMarkers: function(container, state) {
            if (!container) {
                this.log('No container provided for marker processing');
                return;
            }
        
            try {
                // Track marker-table pairs for proper processing order
                const markerTablePairs = [];
                const markerSelector = 'p:not([data-processed-marker]), div > p:not([data-processed-marker]), span:not([data-processed-marker])';
                const markers = Array.from(container.querySelectorAll(markerSelector));
                
                this.log('Scanning for markers:', {
                    container: container.tagName,
                    markersFound: markers.length
                });
        
                // Process each marker and find its associated table
                markers.forEach(marker => {
                    const markerText = marker.textContent.trim().toLowerCase();
                    if (this.validMarkers.includes(markerText)) {
                        const table = this.findNextTable(marker);
                        if (table) {
                            // Mark the marker as processed
                            marker.style.cssText = 'display: none !important; visibility: hidden !important;';
                            marker.setAttribute('data-processed-marker', 'true');
                            marker.classList.add('processed-marker');
                            marker.setAttribute('data-table-marker', 'true');
        
                            if (markerText === 'mobile-no-conversion') {
                                // For mobile-no-conversion, just mark the table and skip conversion
                                table.setAttribute('data-no-conversion', 'true');
                                table.setAttribute('data-converted', 'true');
                                this.converted.set(table, true);
                                
                                // Hide the marker
                                if (marker.parentNode) {
                                    marker.remove();
                                }
                            } else {
                                // For all other markers, add to processing queue
                                markerTablePairs.push({ marker, table, markerType: markerText });
                            }
                        }
                    }
                });
        
                // Process tables that need conversion
                markerTablePairs.forEach(({ marker, table, markerType }) => {
                    try {
                        // Skip if table is marked for no conversion
                        if (table.hasAttribute('data-no-conversion')) {
                            return;
                        }
        
                        this.log('Processing marker:', { text: markerType });
        
                        let result = null;
                        if (markerType.includes('list')) {
                            result = this.convertToList(table);
                            if (result) {
                                const container = document.createElement('div');
                                container.className = 'responsive-table-container';
                                container.innerHTML = result;
                                table.parentNode.replaceChild(container, table);
                                this.converted.set(table, true);
                            }
                        } else {
                            result = this.processTable(table, marker);
                        }
        
                        if (result) {
                            table.setAttribute('data-converted', 'true');
                            
                            if (marker.parentNode) {
                                marker.remove();
                            }
                        }
                    } catch (error) {
                        this.log('Error processing marker-table pair:', error);
                    }
                });
        
                // Final cleanup of empty elements
                container.querySelectorAll('p:empty, div:empty, span:empty').forEach(element => {
                    if (element.parentNode) {
                        element.remove();
                    }
                });
        
            } catch (error) {
                this.log('Fatal error during marker processing:', error);
            }
        },

        determineTableType: function(table) {
            if (!table || !table.querySelector('tr')) return 'empty';
            
            const rows = Array.from(table.querySelectorAll('tr'));
            const firstRow = rows[0];
            const secondRow = rows[1];

            // Check for two-header table structure first
            if (rows.length === 3 && // Exactly 3 rows
                firstRow.cells.length === 2 && // Two cells in first row
                secondRow.cells.length === 2 && // Two cells in second row
                rows[2].querySelector('td[colspan="2"]')) { // Last row has colspan="2"
                
                // Check if first row cells have similar styling (both headers)
                const firstRowCells = Array.from(firstRow.cells);
                const areHeaderCells = firstRowCells.every(cell => {
                    const hasHeaderStyling = 
                        cell.style.backgroundColor || 
                        cell.getAttribute('style')?.includes('background-color') ||
                        cell.querySelector('span')?.style.color === '#ffffff' ||
                        cell.classList.contains('header');
                    return hasHeaderStyling;
                });

                if (areHeaderCells) {
                    return 'twoHeaderTable';
                }
            }

            // Check for complex hierarchical table with shared rowspans
            if (firstRow?.querySelector('th[scope="col"]') && 
                rows.some(row => row.querySelector('td[rowspan]'))) {
                
                // Safely check second row cells
                const secondRowCells = Array.from(rows[1]?.cells || []);
                const firstRowCells = Array.from(firstRow.cells || []);
                
                if (secondRowCells.length === firstRowCells.length) {
                    const hasSubHeaders = secondRowCells.some(cell => 
                        cell.textContent.trim() && !cell.hasAttribute('rowspan'));
                    if (hasSubHeaders) {
                        return 'complexHierarchicalTable';
                    }
                }
            }
        
            // Route table check (most specific two-column structure)
            const headerColspan = firstRow?.querySelector('th[colspan="2"]');
            if (headerColspan && rows.length >= 3) {
                const secondRow = rows[1];
                if (secondRow?.querySelectorAll('th').length === 2) {
                    return 'routeTable';
                }
            }
        
            // Type-two-layout
            if (table.classList.contains('type-two-layout')) {
                const hasHeaderStructure = Array.from(firstRow?.querySelectorAll('th') || [])
                    .every(th => th.querySelector('.content-cell'));
                const hasDataStructure = Array.from(table.querySelectorAll('td.first'))
                    .every(td => td.querySelector('.content-cell'));
                
                if (hasHeaderStructure && hasDataStructure) {
                    return 'structuredContentTable';
                }
            }
        
            // Grouped headers
            if (firstRow && secondRow) {
                const hasGroupedColspans = firstRow.querySelectorAll('th[colspan]').length > 0;
                const hasSecondRowHeaders = secondRow.querySelectorAll('th').length > 0;
                const hasFirstColumnContentCells = rows.slice(1).some(row => 
                    row.querySelector('td.first')?.querySelector('.content-cell'));
                
                if (hasGroupedColspans && hasSecondRowHeaders && hasFirstColumnContentCells) {
                    return 'groupedHeaders';
                }
            }
        
            // Complex mixed table with specific class and structure indicators
            const hasShadowClass = table.querySelectorAll('.shadow').length > 0;
            const hasContentCells = table.querySelectorAll('.content-cell').length > 0;
            const hasSpecialColspanRows = rows.slice(-2).some(row => 
                row.querySelector('td[colspan="3"]'));
            const hasComplexStructure = firstRow?.querySelectorAll('th[colspan]').length > 0;
            
            if (hasShadowClass && hasContentCells && hasSpecialColspanRows && hasComplexStructure) {
                return 'complexMixedTable';
            }
        
            // Image tables
            if (rows.some(row => row.querySelector('td:first-child img'))) {
                return 'imageTable';
            }
        
            // Simple rowspan table
            const rowspanCell = firstRow?.querySelector('th[rowspan], td[rowspan]');
            if (rowspanCell) {
                const hasPricingStructure = rowspanCell.hasAttribute('rowspan') && 
                    rows[0].querySelector('th:not([rowspan])');
                if (hasPricingStructure) {
                    return 'rowspan';
                }
            }
        
            // Matrix tables
            if (rows.every(row => row.querySelector('th[scope="row"]')) && 
                firstRow.querySelectorAll('th[scope="col"]').length > 0) {
                return 'matrixTable';
            }
        
            // Single header colspan table
            if (firstRow?.querySelector('th[colspan]')) {
                const colspanHeader = firstRow.querySelector('th[colspan]');
                const colspanValue = parseInt(colspanHeader.getAttribute('colspan'));
                const secondRowCells = rows[1]?.querySelectorAll('td, th');
                
                if (rows.length >= 3 && 
                    secondRowCells?.length === colspanValue && 
                    rows[2]?.querySelectorAll('td')?.length === colspanValue) {
                    return 'singleHeaderColspan';
                }
            }
        
            // Regular tables with colspan
            if (rows.slice(1).some(row => row.querySelector('td[colspan]'))) {
                return 'regularWithColspan';
            }
        
            // Single header tables
            if (firstRow && firstRow.querySelectorAll('th').length > 1) {
                return 'singleHeader';
            }
        
            // Simple table (no special attributes)
            if (!table.querySelector('th') && 
                !table.querySelector('[colspan]') && 
                !table.querySelector('[rowspan]')) {
                return 'simpleTable';
            }

            // Check for ArticleHeader row-based table
            const hasRowScopes = rows.some(row => row.querySelector('th[scope="row"]'));
            const hasArticleHeaders = table.querySelectorAll('span.ArticleHeader').length > 0;
            
            if (hasRowScopes && hasArticleHeaders) {
                return 'articleHeaderTable';
            }

            if (firstRow?.querySelector('th[colspan]') && 
                rows[1]?.querySelector('th[rowspan="2"]') &&
                rows[2]?.querySelectorAll('th').length > 0) {
                return 'hierarchicalHeaderTable';
            }

            const hasHeaderRow = rows[0]?.querySelector('th[colspan]');
            const hasSectionHeaders = rows.some(row => {
                const headerCell = row.querySelector('th[scope="row"]');
                return headerCell && (
                    headerCell.hasAttribute('rowspan') || 
                    (headerCell.nextElementSibling?.tagName === 'TD' && 
                     headerCell.nextElementSibling.querySelector('p'))
                );
            });
            
            if (hasHeaderRow && hasSectionHeaders) {
                return 'nestedContentTable';
            }
        
            // Default case
            return 'regular';
        },

        convertTableToStructure: function(table) {
            if (!table) return null;
            const rows = Array.from(table.querySelectorAll('tr'));
            if (!rows.length) return [];
        
            this.log('Converting table structure');
            
            // Check if it's an image table with images in the first column
            const firstColHasImage = rows[0].querySelector('td:first-child img');
            const firstRowSecondCellIsText = !rows[0].querySelector('td:nth-child(2) img');
            const isVerticalImageTable = firstColHasImage && firstRowSecondCellIsText;
        
            if (isVerticalImageTable) {
                this.log('Processing as vertical image table');
                const items = rows.map(row => {
                    const imageCell = row.querySelector('td:first-child');
                    const contentCell = row.querySelector('td:last-child');
                    
                    const imageWrapper = imageCell.querySelector('p');
                    
                    return {
                        headerImage: imageWrapper ? imageWrapper.outerHTML : imageCell.innerHTML,
                        title: contentCell.querySelector('u strong, u')?.textContent.trim() || '',
                        content: [{
                            type: 'value',
                            text: contentCell.innerHTML
                        }]
                    };
                });
        
                return items;
            }
        
            // Determine regular table type and process accordingly
            const type = this.determineTableType(table);
            
            this.log('Converting table structure:', { type, rowCount: rows.length });
        
            switch(type) {
                case 'singleHeader':
                    return this.processSingleHeaderTable(table, rows);
                case 'twoHeaderTable':
                    return this.processTwoHeaderTable(table);
                case 'complexHierarchicalTable':
                    return this.processComplexHierarchicalTable(table, rows);
                case 'matrixTable':
                    return this.processMatrixTable(table, rows);
                case 'structuredContentTable':
                    return this.processStructuredContentTable(table, rows);
                case 'singleHeaderColspan':
                    return this.processSingleHeaderColspanTable(table, rows);
                case 'groupedHeaders':
                    return this.processGroupedHeadersTable(table, rows);
                case 'rowspan':
                    return this.processRowspanTable(table, rows);
                case 'regularWithColspan':
                    return this.processRegularTableWithColspan(table, rows);
                case 'simpleTable':
                    return this.processSimpleTable(table, rows);
                case 'imageTable':
                    return this.processImageTable(table, rows);
                case 'routeTable':  
                    return this.processTwoColumnWithRouteTable(table, rows); 
                case 'complexMixedTable':
                    return this.processComplexMixedTable(table, rows);
                case 'articleHeaderTable':
                    return this.processArticleHeaderTable(table);
                case 'hierarchicalHeaderTable':
                    return this.processHierarchicalHeaderTable(table);  
                case 'nestedContentTable':
                    return this.processNestedContentTable(table);
                default:
                    return this.processRegularTable(table, rows);
            }
            
        },
    

    // 5. Table Convertion Methods
        processSingleHeaderColspanTable: function(table, rows) {
            const items = [];
            const headerCell = rows[0].querySelector('th[colspan]');
            const title = this.cleanText(headerCell.textContent);
            const content = [];
        
            // Get categories from second row
            const categories = Array.from(rows[1].querySelectorAll('td')).map(td => 
                this.cleanText(td.textContent)
            );
        
            // Process values from third row
            rows[2].querySelectorAll('td').forEach((td, index) => {
                content.push({
                    type: 'categoryHeader',
                    text: categories[index]
                });
        
                const paragraphs = Array.from(td.querySelectorAll('p'))
                    .map(p => this.cleanText(p.textContent))
                    .filter(text => text);
                    
                content.push({
                    type: 'value',
                    text: paragraphs.join('\n')
                });
            });
        
            items.push({ title, content });
            return items;
        },
            
        // Type 2: Grouped headers with subcategories
        processGroupedHeadersTable: function(table, rows) {
            const items = [];
            const headerRows = rows.slice(0, 2);
            const contentRows = rows.slice(2);
        
            // Get main season headers (HIGH SEASON / LOW SEASON)
            const seasonHeaders = Array.from(headerRows[0].querySelectorAll('th[colspan]'))
                .map(th => ({
                    text: this.cleanText(th.textContent),
                    colspan: parseInt(th.getAttribute('colspan')) || 1
                }));
        
            // Get subheaders (OVERWEIGHT, OVERSIZE, etc.)
            const subheaders = Array.from(headerRows[1].querySelectorAll('th')).slice(1)
                .map(th => {
                    const contentTexts = Array.from(th.querySelectorAll('.content-cell-text'))
                        .map(el => this.cleanText(el.textContent))
                        .filter(text => text);
                    return contentTexts.join(' ') || this.cleanText(th.textContent);
                });
        
            // Process each route row
            contentRows.forEach(row => {
                const titleCell = row.querySelector('td.first');
                if (!titleCell) return;
        
                // Get route title
                const title = titleCell.querySelector('.content-cell-text') ? 
                    Array.from(titleCell.querySelectorAll('.content-cell-text'))
                        .map(el => this.cleanText(el.textContent))
                        .filter(text => text)
                        .join(' ') :
                    this.cleanText(titleCell.textContent);
        
                const content = [];
                let currentHeaderIndex = 0;
        
                // Process each season section
                seasonHeaders.forEach(season => {
                    content.push({
                        type: 'groupHeader',
                        text: season.text
                    });
        
                    // Process subheaders within this season
                    for (let i = 0; i < season.colspan; i++) {
                        const valueCell = row.cells[currentHeaderIndex + 1];
                        if (valueCell) {
                            content.push({
                                type: 'categoryHeader',
                                text: subheaders[currentHeaderIndex]
                            });
        
                            // Handle multi-currency values
                            const paragraphs = valueCell.querySelectorAll('p');
                            if (paragraphs.length) {
                                paragraphs.forEach(p => {
                                    const text = this.cleanText(p.textContent);
                                    if (text) {
                                        content.push({
                                            type: 'value',
                                            text: text
                                        });
                                    }
                                });
                            } else {
                                const text = this.cleanText(valueCell.textContent);
                                if (text) {
                                    content.push({
                                        type: 'value',
                                        text: text
                                    });
                                }
                            }
                        }
                        currentHeaderIndex++;
                    }
                });
        
                if (title) {
                    items.push({ title, content });
                }
            });
        
            return items;
        },
        
        // Type 3: Rowspan structure
        processRowspanTable: function(table, rows) {
            const items = [];
            const rowspanCell = table.querySelector('th[rowspan], td[rowspan]');
            if (!rowspanCell) return [];
        
            // Get title from all paragraphs in rowspan cell
            const titleParagraphs = Array.from(rowspanCell.querySelectorAll('p'))
                .map(p => this.cleanText(p.textContent))
                .filter(text => text);
            
            const title = titleParagraphs.join(' ') || this.cleanText(rowspanCell.textContent);
            const content = [];
        
            // Process each row starting from the first one
            rows.forEach(row => {
                const headerCell = row.querySelector('th:not([rowspan])');
                const dataCell = row.querySelector('td');
                
                if (headerCell) {
                    content.push({
                        type: 'categoryHeader',
                        text: this.cleanText(headerCell.textContent)
                    });
                }
                
                if (dataCell) {
                    const paragraphs = Array.from(dataCell.querySelectorAll('p'))
                        .map(p => this.cleanText(p.textContent))
                        .filter(text => text);
        
                    paragraphs.forEach(text => {
                        if (text) {
                            content.push({
                                type: 'value',
                                text: text
                            });
                        }
                    });
        
                    // If no paragraphs found, use direct text content
                    if (!paragraphs.length) {
                        const text = this.cleanText(dataCell.textContent);
                        if (text) {
                            content.push({
                                type: 'value',
                                text: text
                            });
                        }
                    }
                }
            });
        
            if (title && content.length) {
                items.push({ title, content });
            }
        
            return items;
        },
        
        // Type 4: Regular table structure
        processRegularTable: function(table, rows) {
            const items = [];
            const headers = Array.from(rows[0].querySelectorAll('th'))
                .slice(1)
                .map(th => this.cleanText(th.textContent));
        
            rows.slice(1).forEach(row => {
                const titleCell = row.querySelector('th, td:first-child');
                if (!titleCell) return;
        
                const title = this.cleanText(titleCell.textContent);
                const content = [];
        
                headers.forEach((header, index) => {
                    content.push({
                        type: 'categoryHeader',
                        text: header
                    });
        
                    const cell = row.cells[index + 1];
                    if (cell) {
                        const text = this.cleanText(cell.textContent);
                        if (text && text !== '-') {
                            content.push({
                                type: 'value',
                                text: text
                            });
                        }
                    }
                });
        
                if (content.length) {
                    items.push({ title, content });
                }
            });
        
            return items;
        },  

        // Type 5: Complex rowspan table structure
        processComplexRowspans: function(table, rows) {
            const items = [];
            let headers = [];
        
            // Extract headers from first row
            const headerRow = rows[0];
            if (headerRow) {
                headers = Array.from(headerRow.querySelectorAll('th')).slice(1).map(th => {
                    const contentTexts = Array.from(th.querySelectorAll('.content-cell-text'))
                        .map(el => el.textContent.trim())
                        .filter(text => text)
                        .join(' ');
                    return contentTexts || th.textContent.trim();
                });
            }
        
            // Process each data row
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const firstCell = row.querySelector('td.first, th:first-child');
                if (!firstCell) continue;
        
                // Check if this is a special info row (like TAP Miles&Go)
                const isInfoRow = row.querySelector('td[colspan="3"]');
                if (isInfoRow) {
                    const title = this.extractNestedText(firstCell);
                    const contentCell = row.querySelector('td[colspan="3"]');
                    const paragraphs = Array.from(contentCell.querySelectorAll('p'))
                        .map(p => this.cleanText(p.textContent))
                        .filter(text => text);
        
                    items.push({
                        title: title,
                        content: paragraphs.map(text => ({
                            type: 'value',
                            text: text
                        }))
                    });
                    continue;
                }
        
                // Process regular fare row
                const title = this.extractNestedText(firstCell);
                const content = [];
        
                // Add column headers as category headers
                headers.forEach((header, index) => {
                    content.push({
                        type: 'categoryHeader',
                        text: header
                    });
        
                    const cell = row.cells[index + 1];
                    if (cell) {
                        const value = this.extractNestedText(cell);
                        if (value && value !== '-') {
                            content.push({
                                type: 'value',
                                text: value
                            });
                        }
                    }
                });
        
                if (content.length) {
                    items.push({ title, content });
                }
            }
        
            return items;
        },

        // Type 6: Full Width Header table structure
        processFullWidthHeaderTable: function(table, rows) {
            const headerRows = table.querySelectorAll('thead tr');
            if (!headerRows || headerRows.length < 2) return null;
        
            // Get the main title from first header row
            const mainTitle = this.cleanText(headerRows[0].querySelector('th').textContent);
            const bodyRows = table.querySelectorAll('tbody tr');
            const items = [];
        
            bodyRows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (!cells.length) return;
                
                const title = this.cleanText(cells[0].textContent);
                const content = [];
                
                // Get headers from second header row
                headerRows[1].querySelectorAll('th').forEach((header, index) => {
                    content.push({
                        type: 'categoryHeader',
                        text: this.cleanText(header.textContent)
                    });
        
                    if (cells[index]) {
                        content.push({
                            type: 'value',
                            text: this.cleanText(cells[index].textContent)
                        });
                    }
                });
        
                if (content.length) {
                    items.push({ title, content });
                }
            });
        
            return {
                pageTitle: mainTitle,
                items: items
            };
        },

        // Type 7: Regular with Colspan table structure
        processTwoColumnWithRouteTable: function (table) {
            if (!table) {
                this.log("Table is not provided.");
                return null;
            }
        
            const rows = Array.from(table.querySelectorAll('tr')); // Get all table rows
            if (rows.length < 3) {
                this.log("Insufficient rows to process as a route table.");
                return null;
            }
        
            // Extract table title from the first row (spans two columns)
            const tableTitle = this.cleanText(rows[0].querySelector('th[colspan="2"]')?.textContent || '');
            this.log("Table Title:", { tableTitle });
        
            // Extract header from the second row
            const headers = Array.from(rows[1].querySelectorAll('th')).map(header =>
                this.cleanText(header.textContent)
            );
            if (headers.length < 2) {
                this.log("Invalid header row structure.");
                return null;
            }
            const valueHeader = headers[1]; // Value header is typically in the second column
        
            // Initialize an array to hold processed items
            const items = [];
        
            // Process each data row (starting from the third row)
            rows.slice(2).forEach((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) {
                    this.log(`Skipping row ${index + 3} due to insufficient columns.`, { row });
                    return; // Skip rows with insufficient columns
                }
        
                // Extract title and content
                const title = this.cleanText(cells[0].textContent);
                const content = [
                    {
                        type: 'categoryHeader',
                        text: valueHeader,
                    },
                    {
                        type: 'value',
                        text: this.cleanText(cells[1].textContent),
                    },
                ];
        
                items.push({ title, content });
            });
        
            // Log the final items for debugging
            this.log("Processed Route Table Items:", { items });
        
            // Return the processed structure
            return {
                pageTitle: tableTitle,
                items: items,
            };
        },
        
        // Type 8: Single Header table structure
        processSingleHeaderTable: function(table, rows) {
            const items = [];
            const headerRow = rows[0];
            const headers = Array.from(headerRow.querySelectorAll('th'))
                .map(th => this.cleanText(th.textContent));
        
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const titleCell = row.querySelector('td:first-child, th:first-child');
                if (!titleCell) continue;
        
                const title = this.cleanText(titleCell.textContent);
                const content = [];
                
                const valueCells = Array.from(row.querySelectorAll('td:not(:first-child)'));
                headers.slice(1).forEach((header, idx) => {
                    content.push({
                        type: 'categoryHeader',
                        text: header
                    });
                    
                    const cell = valueCells[idx];
                    if (cell) {
                        const paragraphs = cell.querySelectorAll('p');
                        if (paragraphs.length) {
                            Array.from(paragraphs).forEach(p => {
                                content.push({
                                    type: 'value',
                                    text: this.cleanText(p.textContent)
                                });
                            });
                        } else {
                            content.push({
                                type: 'value',
                                text: this.cleanText(cell.textContent)
                            });
                        }
                    }
                });
        
                items.push({ title, content });
            }
        
            return items;
        },

        // Type 9: Simple table structure
        processSimpleTable: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const items = [];
            
            rows.forEach(row => {
                const cells = Array.from(row.cells);
                if (cells.length < 1) return;
                
                // First cell becomes title
                const title = this.cleanText(cells[0].textContent);
                if (!title) return;
                
                // Remaining cells become content
                const content = [];
                for (let i = 1; i < cells.length; i++) {
                    const cellText = this.cleanText(cells[i].textContent);
                    if (cellText) {
                        content.push({
                            type: 'value',
                            text: cellText
                        });
                    }
                }
                
                if (content.length > 0) {
                    items.push({ title, content });
                }
            });
            
            return items;
        },        

        // Type 10: Image table structure
        processImageTable: function(table, rows) {
            const items = [];
            const firstRow = rows[0];
            
            // Detect vertical vs horizontal layout
            const firstColHasImage = firstRow?.querySelector('td:first-child img');
            const firstRowSecondCellIsText = !firstRow?.querySelector('td:nth-child(2) img');
            const isVerticalLayout = firstColHasImage && firstRowSecondCellIsText;
            
            if (isVerticalLayout) {
                // Process vertical layout - each row is an item
                rows.forEach(row => {
                    const [imageCell, contentCell] = row.querySelectorAll('td');
                    if (!imageCell || !contentCell) return;
                    
                    const img = imageCell.querySelector('img');
                    if (!img) return;
                    
                    // Process each paragraph/element in the content cell separately
                    const contentElements = contentCell.children;
                    const contents = [];
                    
                    Array.from(contentElements).forEach(element => {
                        if (element.textContent.trim()) {
                            contents.push({
                                type: 'value',
                                text: element.outerHTML
                            });
                        }
                    });
                    
                    items.push({
                        headerImage: `<div class="header-image">${img.outerHTML}</div>`,
                        title: '',
                        content: contents
                    });
                });
            } else {
                // Process horizontal layout - first row images, following rows become content
                const imageCells = Array.from(firstRow.querySelectorAll('td'));
                imageCells.forEach((cell, index) => {
                    const img = cell.querySelector('img');
                    if (!img) return;
                    
                    // Gather content from subsequent rows, preserving paragraph structure
                    const contents = [];
                    for (let i = 1; i < rows.length; i++) {
                        const contentCell = rows[i].cells[index];
                        if (contentCell) {
                            // Process each paragraph/element in the content cell
                            Array.from(contentCell.children).forEach(element => {
                                if (element.textContent.trim()) {
                                    contents.push({
                                        type: 'value',
                                        text: element.outerHTML
                                    });
                                }
                            });
                            
                            // If cell has direct text content (not in paragraphs), add it as well
                            const directText = Array.from(contentCell.childNodes)
                                .filter(node => node.nodeType === 3) // Text nodes only
                                .map(node => node.textContent.trim())
                                .filter(text => text);
                                
                            directText.forEach(text => {
                                if (text) {
                                    contents.push({
                                        type: 'value',
                                        text: `<p>${text}</p>`
                                    });
                                }
                            });
                        }
                    }
                    
                    items.push({
                        headerImage: `<div class="header-image">${img.outerHTML}</div>`,
                        title: '',
                        content: contents
                    });
                });
            }
            
            return items;
        },

        // Type 11: Matrix table structure
        processMatrixTable: function(table, rows) {
            const items = [];
            const headers = Array.from(rows[0].querySelectorAll('th[scope="col"]'))
                .map(th => this.cleanText(th.textContent));
        
            // Process each row (skip header row)
            rows.slice(1).forEach(row => {
                const title = this.cleanText(row.querySelector('th[scope="row"]').textContent);
                const content = [];
        
                // Process each column
                const cells = Array.from(row.querySelectorAll('td'));
                headers.forEach((header, idx) => {
                    content.push({
                        type: 'categoryHeader',
                        text: header
                    });
                    
                    if (cells[idx]) {
                        content.push({
                            type: 'value',
                            text: this.cleanText(cells[idx].textContent)
                        });
                    }
                });
        
                items.push({ title, content });
            });
        
            return items;
        },

        // Type 12: Complex mixed table structure
        processComplexMixedTable: function(table, rows) {
            const items = [];
            const headerCells = Array.from(rows[0].querySelectorAll('th')).slice(1);
            const headers = headerCells.map(cell => {
                const contentTexts = Array.from(cell.querySelectorAll('.content-cell-text'))
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text);
                return {
                    text: contentTexts.join(' '),
                    colspan: parseInt(cell.getAttribute('colspan')) || 1
                };
            });
        
            rows.slice(1).forEach((row, index) => {
                const titleCell = row.querySelector('td.first, th:first-child');
                if (!titleCell) return;
        
                const title = titleCell.querySelector('.content-cell-text') ? 
                    this.cleanText(titleCell.querySelector('.content-cell-text').textContent) :
                    this.cleanText(titleCell.textContent);
                    
                const content = [];
                
                // Check specifically for TD with colspan that spans most/all columns
                const colspanCell = row.querySelector('td[colspan="3"]');
                
                if (colspanCell) {
                    Array.from(colspanCell.querySelectorAll('p'))
                        .map(p => this.cleanText(p.textContent))
                        .filter(text => text)
                        .forEach(text => {
                            content.push({
                                type: 'value',
                                text: text
                            });
                        });
                } else {
                    const dataCells = Array.from(row.querySelectorAll('td:not(.first)'));
                    headers.forEach((header, i) => {
                        content.push({
                            type: 'categoryHeader',
                            text: header.text
                        });
        
                        if (i < dataCells.length) {
                            const valueCell = dataCells[i];
                            const cellText = valueCell.querySelector('.content-cell-text') ?
                                this.cleanText(valueCell.querySelector('.content-cell-text').textContent) :
                                this.cleanText(valueCell.textContent);
                                
                            if (cellText) {
                                content.push({
                                    type: 'value',
                                    text: cellText
                                });
                            }
                        }
                    });
                }
        
                if (content.length) {
                    items.push({ title, content });
                }
            });
        
            return items;
        },

        // Type 13: Type two layout table structure
        processTypeTwoLayout: function(table, rows) {
            const items = [];
            
            // Get header information (skip first column)
            const headerCells = Array.from(rows[0].querySelectorAll('th')).slice(1);
            const headerData = headerCells.map(cell => {
                // Combine all content-cell-text elements into one string for the header
                const texts = Array.from(cell.querySelectorAll('.content-cell-text'))
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text);
                return texts.join(' ');
            });
        
            // Process each data row
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const titleCell = row.querySelector('td.first');
                if (!titleCell) continue;
        
                // Get title from first column by combining all content-cell-text elements
                const titleTexts = Array.from(titleCell.querySelectorAll('.content-cell-text'))
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text);
                const title = titleTexts.join(' ');
        
                const content = [];
                const valueCells = Array.from(row.querySelectorAll('td:not(.first)'));
        
                // For each value column
                headerData.forEach((header, index) => {
                    // Add the column header as category
                    content.push({
                        type: 'categoryHeader',
                        text: header
                    });
        
                    // Get the corresponding value cell
                    const valueCell = valueCells[index];
                    if (valueCell) {
                        // Try content-cell-text first, then fallback to p tag, then direct text
                        let valueText = '';
                        const contentTexts = valueCell.querySelectorAll('.content-cell-text');
                        const paragraphs = valueCell.querySelectorAll('p');
                        
                        if (contentTexts.length > 0) {
                            valueText = Array.from(contentTexts)
                                .map(el => this.cleanText(el.textContent))
                                .filter(text => text)
                                .join(' ');
                        } else if (paragraphs.length > 0) {
                            valueText = Array.from(paragraphs)
                                .map(p => this.cleanText(p.textContent))
                                .filter(text => text)
                                .join(' ');
                        } else {
                            valueText = this.cleanText(valueCell.textContent);
                        }
        
                        content.push({
                            type: 'value',
                            text: valueText
                        });
                    }
                });
        
                if (title) {
                    items.push({ title, content });
                }
            }
        
            return items;
        },

        // Type 14: Structured content table structure
        processStructuredContentTable: function(table) {
            const items = [];
            const rows = Array.from(table.querySelectorAll('tr'));
            const headerCells = Array.from(rows[0]?.querySelectorAll('th')).slice(1);
            
            const headers = headerCells.map(cell => {
                return Array.from(cell.querySelectorAll('.content-cell-text'))
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text)
                    .join(' ');
            });
         
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const titleCell = row.querySelector('td.first');
                const valueCells = Array.from(row.querySelectorAll('td:not(.first)'));
                
                if (!titleCell) continue;
         
                const title = Array.from(titleCell.querySelectorAll('.content-cell-text'))
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text)
                    .join(' ');
         
                const content = [];
         
                // Handle colspan cells differently
                const hasColspan = valueCells.some(cell => cell.hasAttribute('colspan'));
                
                if (hasColspan) {
                    // For colspan rows, use direct content without headers
                    valueCells.forEach(cell => {
                        const cellText = Array.from(cell.querySelectorAll('.content-cell-text, p'))
                            .map(el => this.cleanText(el.textContent))
                            .filter(text => text)
                            .join(' ');
                        
                        if (cellText) {
                            content.push({
                                type: 'value',
                                text: cellText
                            });
                        }
                    });
                } else {
                    // Regular row processing with headers
                    headers.forEach((header, index) => {
                        if (header) {
                            content.push({
                                type: 'categoryHeader',
                                text: header
                            });
                        }
         
                        const valueCell = valueCells[index];
                        if (valueCell) {
                            const cellText = Array.from(valueCell.querySelectorAll('.content-cell-text'))
                                .map(el => this.cleanText(el.textContent))
                                .filter(text => text)
                                .join(' ');
         
                            if (cellText) {
                                content.push({
                                    type: 'value',
                                    text: cellText
                                });
                            }
                        }
                    });
                }
         
                if (title && content.length) {
                    items.push({ title, content });
                }
            }
         
            return items;
        },

        // Type 14: Structured content table structure
        processRegularTableWithColspan: function(table, rows) {
            const items = [];
            const headers = Array.from(rows[0].querySelectorAll('th'))
                .map(th => this.cleanText(th.textContent));
        
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const titleCell = row.querySelector('td:first-child, th:first-child');
                if (!titleCell) continue;
        
                const title = this.cleanText(titleCell.textContent);
                const content = [];
        
                // Handle cells with colspan
                let currentIndex = 1;
                const cells = Array.from(row.cells).slice(1);
                
                cells.forEach(cell => {
                    const colspan = parseInt(cell.getAttribute('colspan')) || 1;
                    
                    // Add headers for each column spanned
                    for (let j = 0; j < colspan; j++) {
                        if (headers[currentIndex + j]) {
                            content.push({
                                type: 'categoryHeader',
                                text: headers[currentIndex + j]
                            });
                        }
                    }
                    
                    // Add cell content
                    const paragraphs = cell.querySelectorAll('p');
                    if (paragraphs.length) {
                        Array.from(paragraphs)
                            .map(p => this.cleanText(p.textContent))
                            .filter(text => text)
                            .forEach(text => {
                                content.push({
                                    type: 'value',
                                    text: text
                                });
                            });
                    } else {
                        const text = this.cleanText(cell.textContent);
                        if (text) {
                            content.push({
                                type: 'value',
                                text: text
                            });
                        }
                    }
                    
                    currentIndex += colspan;
                });
        
                if (title && content.length) {
                    items.push({ title, content });
                }
            }
        
            return items;
        },
        
        processTwoHeaderTable: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const items = [];

            // Process each header into a separate item
            Array.from(rows[0].cells).forEach((headerCell, idx) => {
                const item = {
                    title: this.cleanText(headerCell.textContent),
                    content: []
                };

                // Add content from second row
                if (rows[1]?.cells[idx]) {
                    item.content.push({
                        type: 'value',
                        text: this.cleanText(rows[1].cells[idx].textContent)
                    });
                }

                // Add shared button if exists
                if (rows[2]?.cells[0]) {
                    item.content.push({
                        type: 'value',
                        text: rows[2].cells[0].outerHTML
                    });
                }

                items.push(item);
            });

            return items;
        },

        processComplexHierarchicalTable: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const mainHeaders = Array.from(rows[0].querySelectorAll('th[scope="col"]'))
                .slice(1) // Skip the first header (usually "Franquia de Bagagem")
                .map(th => this.cleanText(th.textContent));
            
            const subHeaders = Array.from(rows[1].querySelectorAll('td'))
                .slice(1) // Skip the first empty cell
                .map(td => this.cleanText(td.textContent));
            
            const items = [];
            let currentRowspan = null;
            let rowspanValues = null;
            
            // Process data rows
            for (let i = 2; i < rows.length; i++) {
                const row = rows[i];
                const firstCell = row.cells[0];
                
                // If this row is part of a rowspan
                if (currentRowspan && rowspanValues) {
                    // Create a new item with the same values as the rowspan
                    items.push({
                        title: this.cleanText(firstCell.textContent),
                        content: this.createHierarchicalContent(mainHeaders, subHeaders, rowspanValues)
                    });
                    currentRowspan--;
                    if (currentRowspan === 0) {
                        currentRowspan = null;
                        rowspanValues = null;
                    }
                    continue;
                }
                
                // Check for new rowspan
                const rowspanCell = row.querySelector('td[rowspan]');
                if (rowspanCell) {
                    currentRowspan = parseInt(rowspanCell.getAttribute('rowspan'));
                    rowspanValues = Array.from(row.cells)
                        .slice(1)
                        .map(cell => this.cleanText(cell.textContent));
                }
                
                // Process regular row or first row of rowspan
                const values = Array.from(row.cells)
                    .slice(1)
                    .map(cell => this.cleanText(cell.textContent));
                    
                items.push({
                    title: this.cleanText(firstCell.textContent),
                    content: this.createHierarchicalContent(mainHeaders, subHeaders, values)
                });
            }
            
            return items;
        },
        
        createHierarchicalContent: function(mainHeaders, subHeaders, values) {
            const content = [];
            
            mainHeaders.forEach((header, index) => {
                // Add main header (dark grey)
                content.push({
                    type: 'groupHeader',
                    text: header
                });
                
                // Add sub header (light grey)
                content.push({
                    type: 'categoryHeader',
                    text: subHeaders[index]
                });
                
                // Add value (white)
                if (values[index]) {
                    content.push({
                        type: 'value',
                        text: values[index]
                    });
                }
            });
            
            return content;
        },

        processArticleHeaderTable: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const items = [];
        
            rows.forEach(row => {
                // Get the header from the th[scope="row"]
                const headerCell = row.querySelector('th[scope="row"]');
                const contentCell = row.querySelector('td');
                
                if (!headerCell || !contentCell) return;
        
                // Get header text from ArticleHeader span
                const headerSpan = headerCell.querySelector('span.ArticleHeader');
                if (!headerSpan) return;
        
                const title = this.cleanText(headerSpan.textContent);
                const content = [];
        
                // Process content cell's paragraphs
                const paragraphs = Array.from(contentCell.querySelectorAll('p'));
                paragraphs.forEach(p => {
                    // If paragraph has an ArticleHeader, make it a subheader
                    const articleHeader = p.querySelector('span.ArticleHeader');
                    if (articleHeader) {
                        content.push({
                            type: 'categoryHeader',
                            text: this.cleanText(articleHeader.textContent)
                        });
                    } else {
                        content.push({
                            type: 'value',
                            text: this.cleanText(p.textContent)
                        });
                    }
                });
        
                if (title && content.length) {
                    items.push({ title, content });
                }
            });
        
            return items;
        },

        processHierarchicalHeaderTable: function(table) {
            const items = [];
            const rows = Array.from(table.querySelectorAll('tr'));
            
            // Get main header that spans all columns
            const mainHeader = this.extractNestedText(rows[0].querySelector('th[colspan]'));
        
            // Get column headers from multi-row header structure
            const columnHeaders = Array.from(rows[2].querySelectorAll('th')).map(th => 
                this.extractNestedText(th));
        
            // Process data rows
            for (let i = 3; i < rows.length; i++) {
                const row = rows[i];
                const cells = Array.from(row.cells);
                
                // Build identifier from first two cells
                const identifiers = cells.slice(0, 2).map(cell => this.extractNestedText(cell));
                const title = identifiers.join(' - ');
                const content = [];
        
                // Process value cells with their corresponding headers
                for (let j = 2; j < cells.length; j++) {
                    const header = columnHeaders[j - 2];
                    content.push({
                        type: 'groupHeader',
                        text: header
                    });
        
                    // Extract all values from the cell
                    const values = Array.from(cells[j].querySelectorAll('p'))
                        .map(p => this.extractNestedText(p))
                        .filter(text => text);
        
                    values.forEach(value => {
                        content.push({
                            type: 'value',
                            text: value
                        });
                    });
                }
        
                items.push({ title, content });
            }
        
            return items;
        },

        processNestedContentTable: function(table) {
            if (!table) return null;
            
            const rows = Array.from(table.querySelectorAll('tr'));
            if (rows.length < 2) return null;
        
            const titleCell = rows[0].querySelector('th[colspan]');
            const tableTitle = titleCell ? this.cleanText(titleCell.textContent) : '';
            const items = [];
            
            // Process each row group
            for (let i = 1; i < rows.length;) {
                const headerRow = rows[i];
                const mainHeader = headerRow.querySelector('th');
                
                if (mainHeader) {
                    const section = {
                        title: this.cleanText(mainHeader.textContent),
                        content: []
                    };
                    
                    // Process subsequent rows until next header
                    let j = i + 1;
                    while (j < rows.length && !rows[j].querySelector('th')) {
                        const cells = Array.from(rows[j].querySelectorAll('td'));
                        if (cells.length >= 2) {
                            const key = this.cleanText(cells[0].textContent);
                            const value = this.cleanText(cells[1].textContent);
                            if (key && value) {
                                section.content.push({
                                    type: 'value',
                                    text: `${key}\t${value}`
                                });
                            }
                        } else if (cells.length === 1) {
                            const value = this.cleanText(cells[0].textContent);
                            if (value) {
                                section.content.push({
                                    type: 'value',
                                    text: value
                                });
                            }
                        }
                        j++;
                    }
                    items.push(section);
                    i = j;
                } else {
                    i++;
                }
            }
        
            return {
                title: tableTitle,
                items: items
            };
        },


        // Helpers for table conversion
        extractNestedText: function(cell) {
            if (!cell) return '';
            
            // First try to get content from content-cell-text divs
            const contentTexts = cell.querySelectorAll('.content-cell-text');
            if (contentTexts.length) {
                return Array.from(contentTexts)
                    .map(el => this.cleanText(el.textContent))
                    .filter(text => text)
                    .join(' ');
            }
            
            // Then try paragraphs
            const paragraphs = cell.querySelectorAll('p');
            if (paragraphs.length) {
                return Array.from(paragraphs)
                    .map(p => this.cleanText(p.textContent))
                    .filter(text => text)
                    .join(' ');
            }
            
            // Finally, fall back to direct text content
            return this.cleanText(cell.textContent);
        },

        getColumnHeaders: function(table) {
            const headerRow = table.querySelector('tr');
            if (!headerRow) return [];

            return Array.from(headerRow.querySelectorAll('th'))
                .map(th => ({
                    text: this.cleanText(th.textContent),
                    colspan: parseInt(th.getAttribute('colspan')) || 1
                }));
        },

        convertTableByMarkerType: function(table, markerType) {
            const markerText = (typeof markerType === 'string' ? markerType : markerType.textContent)?.trim().toLowerCase();
            
            switch (markerText) {
                case 'table-accordion':
                case 'mobile-accordion': {
                    const type = this.determineTableType(table);
                    
                    if (type === 'nestedContentTable') {
                        const result = this.processNestedContentTable(table);
                        if (!result) return null;
                        
                        let html = '<div class="accordion" data-accordion><div class="accordion-list">';
                        
                        // Add title if present
                        if (result.title) {
                            html += `<div class="title">${result.title}</div>`;
                        }
                        
                        // Process each section
                        result.items.forEach(item => {
                            html += `
                                <div class="list-item">
                                    <div class="ec-head" data-accordion-trigger>
                                        <h3 class="article-header">${item.title}</h3>
                                        <svg class="arrow" viewBox="0 0 24 24">
                                            <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                        </svg>
                                    </div>
                                    <div class="expanded-content">`;
                            
                            // Process nested content
                            if (item.content) {
                                item.content.forEach(content => {
                                    if (typeof content === 'string') {
                                        html += `<div class="info-group"><div class="value">${content}</div></div>`;
                                    } else {
                                        switch (content.type) {
                                            case 'groupHeader':
                                                html += `<div class="info-group"><div class="label group">${content.text}</div></div>`;
                                                break;
                                            case 'categoryHeader':
                                                html += `<div class="info-group"><div class="label category">${content.text}</div></div>`;
                                                break;
                                            case 'value':
                                                html += `<div class="info-group"><div class="value">${content.text}</div></div>`;
                                                break;
                                        }
                                    }
                                });
                            }
                            
                            html += '</div></div>';
                        });
                        
                        html += '</div></div>';
                        return html;
                    }
                    
                    // Handle other table types
                    return this.convertToAccordion(table);
                }
                
                // Other cases remain unchanged
                case 'table-list':
                case 'mobile-list':
                    return this.convertToList(table);
                    
                case 'table-list-like-accordion':
                case 'mobile-list-like-accordion':
                    return this.convertToAccordionStyleList(table);
                    
                case 'table-carousel':
                case 'mobile-carousel':
                    return this.convertToCarousel(table);
                    
                default:
                    return null;
            }
        },

        extractCellContent: function(cell) {
            let html = '';
            
            // Handle image (centered inside a div)
            const img = cell.querySelector('img');
            if (img) {
                html += `<div class="list-content image" style="text-align: center">${img.outerHTML}</div>`;
                return html;  // Return early after handling image
            }
            
            // Handle paragraphs (filter empty ones)
            const paragraphs = Array.from(cell.querySelectorAll('p'));
            const filteredParagraphs = this.filterEmptyParagraphs(
                paragraphs.map(p => p.innerHTML)
            );
            
            if (filteredParagraphs.length > 0) {
                filteredParagraphs.forEach(content => {
                    if (content.trim()) {  // Additional check for empty content
                        html += `<div class="list-content">${content}</div>`;
                    }
                });
            }
        
            // Handle lists (only process <ul> with <li> items)
            const lists = Array.from(cell.querySelectorAll('ul'));
            lists.forEach(ul => {
                const items = Array.from(ul.querySelectorAll('li'));
                if (items.length > 0) {  // Only process lists with items
                    html += '<ul class="list-content">';
                    items.forEach(li => {
                        const content = li.innerHTML.trim();
                        if (content) {  // Only add non-empty list items
                            html += `<li>${content}</li>`;
                        }
                    });
                    html += '</ul>';
                }
            });
        
            return html.trim();  // Trim and return the final HTML
        },


    // 6. HTML Store and Restore
        storeOriginalTable: function(table) {
            if (!this.originalTables.has(table)) {
                const originalHtml = table.outerHTML; 
                this.originalTables.set(table, originalHtml);
            }
        },

        restoreOriginalHTML: function () {
            this.log('Attempting to restore original HTML');
        
            if (!this.originalHtmlContent) {
                this.log('No original HTML content stored');
                return false;
            }
        
            const container = document.querySelector(this.selectors.parentContainer);
            if (!container) {
                this.log('Parent container not found');
                return false;
            }
        
            // Debug current and original HTML comparison
            this.log('Restoring HTML...', {
                currentLength: container.innerHTML.length,
                originalLength: this.originalHtmlContent.length,
                isSame: container.innerHTML === this.originalHtmlContent,
            });
        
            // Restore original HTML
            container.innerHTML = this.originalHtmlContent;
        
            // Reset state
            this.converted = new WeakMap();
        
            this.log('Original HTML restored successfully');
            return true;
        },
        
        restoreToDesktop: function() {
            this.log('Starting desktop restoration');
        
            if (!this.originalHtmlContent) {
                this.log('ERROR: No original HTML content to restore');
                return false;
            }
        
            const contentContainer = document.querySelector(this.selectors.parentContainer);
            if (!contentContainer) {
                this.log('ERROR: Content container not found for restoration');
                return false;
            }
        
            try {
                // Store scroll position
                const scrollPos = window.scrollY;
        
                // Remove event listeners before modifying DOM
                this.removeAllEventListeners();
        
                // Restore original content directly to the content container
                contentContainer.innerHTML = this.originalHtmlContent;
        
                // Reset state
                this.converted = new WeakMap();
                this._isMobileView = false;
        
                // Show any hidden markers
                document.querySelectorAll('[data-table-marker="true"]').forEach(marker => {
                    marker.style.display = '';
                    marker.classList.remove('processed-marker');
                    marker.removeAttribute('data-table-marker');
                });
        
                // Restore scroll position
                window.scrollTo(0, scrollPos);
        
                this.log('Desktop restoration complete', {
                    contentRestored: true,
                    length: contentContainer.innerHTML.length,
                    matches: contentContainer.innerHTML === this.originalHtmlContent
                });
        
                return true;
            } catch (error) {
                this.log('Error during desktop restoration:', error);
                return false;
            }
        },


    // 7. Responsive Handling
        isMobileView: function() {
            if (!this.mediaQuery) {
                this.mediaQuery = window.matchMedia(`(max-width: ${this.mobileBreakpoint}px)`);
            }
            return this.mediaQuery.matches;
        },

        handleViewportChange: function() {
            const isMobileView = window.innerWidth < this.mobileBreakpoint;
            this.log('Viewport change detected', {
                width: window.innerWidth,
                isMobileView: isMobileView
            });
            
            if (isMobileView === this._isMobileView) return;
            
            try {
                if (isMobileView) {
                    this._isMobileView = true;
                    this.enableMobileView();
                    this.rebindEventHandlers();
                } else {
                    this._isMobileView = false;
                    const restored = this.restoreToDesktop();
                    if (restored) {
                        this.rebindEventHandlers();
                    } else {
                        this.initialize();
                    }
                }
            } catch (error) {
                this.log('Error during viewport change:', error);
                this.initialize();
            }
        },

        removeAllEventListeners: function() {
            this.log('Removing all event listeners');
            
            // Remove old delegated handler if it exists
            if (this._boundEventHandler) {
                document.removeEventListener('click', this._boundEventHandler);
                delete this._boundEventHandler;
            }

            // Clean up specific elements
            const containers = document.querySelectorAll('.responsive-table-container');
            containers.forEach(container => {
                this.removeEventListeners(container);
            });
        },
        
        enableMobileView: function() {
            this.log('Enabling mobile view');
            let componentsConverted = false;
            
            // Handle malformed simple-table-generated-tap divs
            document.querySelectorAll('div.simple-table-generated-tap').forEach(div => {
                if (div.outerHTML.includes('<p="">')) {
                    const newDiv = document.createElement('div');
                    newDiv.className = 'simple-table-generated-tap';
                    
                    // Move all child nodes except the text node and empty p tag
                    Array.from(div.childNodes).forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TABLE') {
                            newDiv.appendChild(node.cloneNode(true));
                        }
                    });
                    
                    div.parentNode.replaceChild(newDiv, div);
                }
            });
        
            // Process all potential markers with enhanced selector
            const markerSelector = 'p:not([data-processed-marker]), div > p:not([data-processed-marker]), span:not([data-processed-marker])';
            document.querySelectorAll(markerSelector).forEach(marker => {
                const text = marker.textContent.trim().toLowerCase();
                if (this.validMarkers.includes(text)) {
                    // Comprehensive hiding of the marker
                    marker.style.cssText = 'display: none !important; visibility: hidden !important; height: 0 !important; width: 0 !important; overflow: hidden !important; position: absolute !important; left: -9999px !important;';
                    marker.setAttribute('data-processed-marker', 'true');
                    marker.classList.add('processed-marker', 'table-marker');
                    
                    // Hide parent if it only contains this marker
                    const markerParent = marker.parentElement;
                    if (markerParent) {
                        const hasOnlyMarker = Array.from(markerParent.childNodes).every(node => {
                            if (node.nodeType === Node.TEXT_NODE) {
                                return !node.textContent.trim();
                            }
                            return node === marker || !node.textContent.trim();
                        });
        
                        if (hasOnlyMarker) {
                            markerParent.style.cssText = 'display: none !important;';
                        }
                    }
                }
            });
        
            // Process tables
            document.querySelectorAll('table:not([data-converted="true"])').forEach(table => {
                if (!this.converted.has(table)) {
                    const marker = this.findTableMarker(table);
                    if (marker) {
                        const markerText = marker.textContent.trim().toLowerCase();
                        
                        // Store original table before conversion
                        if (!this.originalTables.has(table)) {
                            this.originalTables.set(table, table.outerHTML);
                        }
        
                        let result = null;
                        if (markerText.includes('list')) {
                            result = this.convertToList(table);
                            if (result) {
                                const container = document.createElement('div');
                                container.className = 'responsive-table-container';
                                container.innerHTML = result;
                                table.parentNode.replaceChild(container, table);
                                this.converted.set(table, true);
                                componentsConverted = true;
                            }
                        } else {
                            result = this.processTable(table, marker);
                            if (result) {
                                componentsConverted = true;
                            }
                        }
        
                        // Mark table as processed
                        if (result) {
                            table.setAttribute('data-converted', 'true');
                            
                            // Hide the marker and its container if empty
                            if (marker) {
                                marker.style.cssText = 'display: none !important; visibility: hidden !important;';
                                const markerParent = marker.parentElement;
                                if (markerParent && !markerParent.textContent.trim()) {
                                    markerParent.style.cssText = 'display: none !important;';
                                }
                            }
                        }
                    }
                }
            });
        
            // Final cleanup pass for any remaining markers or empty containers
            document.querySelectorAll('[data-processed-marker="true"], .processed-marker, .table-marker').forEach(element => {
                element.style.cssText = 'display: none !important; visibility: hidden !important; height: 0 !important; width: 0 !important; overflow: hidden !important; position: absolute !important; left: -9999px !important;';
                
                // Clean up parent containers
                let currentNode = element;
                while (currentNode.parentElement) {
                    const parent = currentNode.parentElement;
                    const hasOnlyWhitespace = Array.from(parent.childNodes).every(node => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            return !node.textContent.trim();
                        }
                        return node === element || !node.textContent.trim();
                    });
        
                    if (hasOnlyWhitespace) {
                        parent.style.cssText = 'display: none !important;';
                        currentNode = parent;
                    } else {
                        break;
                    }
                }
            });
        
            // Initialize components if any were converted
            if (componentsConverted) {
                this.initializeComponents();
                
                // Rebind event handlers for new components
                this.rebindEventHandlers();
            }
        
            this.log('Mobile view enabled', {
                componentsConverted: componentsConverted,
                markersProcessed: document.querySelectorAll('[data-processed-marker="true"]').length,
                tablesConverted: document.querySelectorAll('[data-converted="true"]').length
            });
        },


    // 8. Marker Handling
        findTableMarker: function(element) {
            if (!this.isMobileView()) return null;
        
            // Look for direct text nodes or paragraphs containing markers
            let current = element;
            while (current) {
                // First check the previous sibling
                if (current.previousElementSibling) {
                    const prevElement = current.previousElementSibling;
                    const markerText = prevElement.textContent?.trim().toLowerCase();
                    
                    if (this.validMarkers.includes(markerText)) {
                        this.log('Found marker in previous sibling:', markerText);
                        return prevElement;
                    }
                }
        
                // Then check parent's previous siblings
                if (current.parentElement) {
                    let parentSibling = current.parentElement.previousElementSibling;
                    while (parentSibling) {
                        const markerText = parentSibling.textContent?.trim().toLowerCase();
                        if (this.validMarkers.includes(markerText)) {
                            this.log('Found marker in parent sibling:', markerText);
                            return parentSibling;
                        }
                        parentSibling = parentSibling.previousElementSibling;
                    }
                    current = current.parentElement;
                } else {
                    break;
                }
            }
        
            return null;
        },
        
        findNextTable: function(marker) {
            this.log('Finding next table for:', marker);
            
            // First check immediate siblings
            let next = marker.nextElementSibling;
            while (next) {
                if (next.tagName === 'TABLE') {
                    return next;
                }
                
                // Check for nested tables
                const nestedTable = next.querySelector('table');
                if (nestedTable) {
                    return nestedTable;
                }
                
                next = next.nextElementSibling;
            }
            
            // Then check parent container for table
            if (marker.parentElement) {
                // Look for table in parent's siblings
                let parent = marker.parentElement;
                next = parent.nextElementSibling;
                
                while (next) {
                    if (next.tagName === 'TABLE') {
                        return next;
                    }
                    
                    // Check for nested tables
                    const nestedTable = next.querySelector('table');
                    if (nestedTable) {
                        return nestedTable;
                    }
                    
                    next = next.nextElementSibling;
                }
                
                // Check for table within the same container as the marker
                const tableInParent = parent.querySelector('table');
                if (tableInParent) {
                    return tableInParent;
                }
            }
            
            return null;
        },

        getPreviousMarker: function(table) {
            let previousElement = table.previousElementSibling;
            
            while (previousElement) {
                if (previousElement.tagName.toLowerCase() === 'p' || previousElement.tagName.toLowerCase() === 'span') {
                    const text = previousElement.textContent.trim().toLowerCase();
                    if (this.validMarkers.includes(text)) {
                        this.log('Found marker:', text);
                        return text;
                    }
                }
                previousElement = previousElement.previousElementSibling;
            }
            
            this.log('No marker found');
            return 'mobile-accordion';  // Default marker type
        },
        
        markTableMarkers: function() {
            const markers = document.querySelectorAll('p:not(.processed-marker), span:not(.processed-marker)');
            
            this.log('Processing markers', { 
                count: markers.length,
                isMobileView: this.isMobileView()
            });
            
            markers.forEach(marker => {
                const markerText = marker.textContent.trim().toLowerCase();
                
                if (this.validMarkers.includes(markerText)) {
                    marker.classList.add('table-marker', 'processed-marker');
                    marker.setAttribute('data-table-marker', 'true');
                    
                    const display = this.isMobileView() ? 'none' : '';
                    this.log('Setting marker display', {
                        marker: markerText,
                        display: display
                    });
                    
                    marker.style.display = display;
                    
                    if (!marker.hasAttribute('data-original-display')) {
                        marker.setAttribute('data-original-display', 
                            window.getComputedStyle(marker).display === 'none' ? 'none' : '');
                    }
                }
            });
        },

        isValidMarker: function(text) {
            if (!text) return false;
            
            const cleaned = text.trim().toLowerCase()
                .replace(/\s+/g, '-')        // Replace multiple spaces with single hyphen
                .replace(/[^\w\-]/g, '');    // Remove any non-word chars except hyphens
            
            this.log('Checking marker:', {
                original: text,
                cleaned: cleaned,
                isValid: this.validMarkers.includes(cleaned)
            });
            
            return this.validMarkers.includes(cleaned);
        },


    // 9. Conversion Methods
        convertToCarousel: function(table) {
            // First, determine the carousel type
            const carouselType = this.determineCarouselType(table);
            return carouselType === 'row-based' 
                ? this.createRowBasedCarousel(table)
                : this.createColumnBasedCarousel(table);
        },
        
        convertToAccordion: function(table) {
            let tableData;
            const type = this.determineTableType(table);
            
            // Use appropriate processor based on table type
            if (type === 'imageTable') {
                const rows = Array.from(table.querySelectorAll('tr'));
                tableData = this.processImageTable(table, rows);
            } else if (type === 'routeTable') {
                tableData = this.processTwoColumnWithRouteTable(table);
                // If we have pageTitle, start building accordion with it
                if (tableData?.pageTitle) {
                    let html = `<div class="accordion" data-accordion><div class="accordion-list">`;
                    
                    // Process each item
                    tableData.items.forEach(item => {
                        html += `
                            <div class="list-item">
                                <div class="ec-head" data-accordion-trigger>
                                    <h3 class="article-header">${item.title}</h3>
                                    <svg class="arrow" viewBox="0 0 24 24">
                                        <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                    </svg>
                                </div>
                                <div class="expanded-content">`;
                        
                        item.content.forEach(content => {
                            switch (content.type) {
                                case 'categoryHeader':
                                    html += `<div class="info-group"><div class="label category">${content.text}</div></div>`;
                                    break;
                                case 'value':
                                    html += `<div class="info-group"><div class="value">${content.text}</div></div>`;
                                    break;
                            }
                        });
                        
                        html += `</div></div>`;
                    });
                    
                    html += '</div></div>';
                    return html;
                }
            } else {
                tableData = this.convertTableToStructure(table);
            }
            
            if (!tableData || !tableData.length) return '';
            
            let html = '<div class="accordion" data-accordion><div class="accordion-list">';
            
            tableData.forEach(item => {
                html += `
                    <div class="list-item">
                        <div class="ec-head" data-accordion-trigger>`;
                
                if (item.headerImage) {
                    html += item.headerImage;
                }
                
                if (item.title) {
                    html += `<h3 class="article-header">${item.title}</h3>`;
                }
                
                html += `
                            <svg class="arrow" viewBox="0 0 24 24">
                                <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                            </svg>
                        </div>
                        <div class="expanded-content">`;
                
                if (item.content && item.content.length) {
                    item.content.forEach(content => {
                        switch (content.type) {
                            case 'groupHeader':
                                html += `<div class="info-group"><div class="label group">${content.text}</div></div>`;
                                break;
                            case 'mainHeader':
                                html += `<div class="info-group"><div class="label main">${content.text}</div></div>`;
                                break;
                            case 'categoryHeader':
                                html += `<div class="info-group"><div class="label category">${content.text}</div></div>`;
                                break;
                            case 'value':
                                const lines = content.text.split('\n');
                                lines.forEach(line => {
                                    if (line.trim()) {
                                        html += `<div class="info-group"><div class="value">${line}</div></div>`;
                                    }
                                });
                                break;
                        }
                    });
                }
                
                html += '</div></div>';
            });
            
            html += '</div></div>';
            return html;
        },

        convertToList: function(table) {
            const prevMarkerType = this.getPreviousMarker(table);
            this.log('Converting list with marker:', prevMarkerType);
            
            if (!prevMarkerType) {
                this.log('No marker found, defaulting to clean list');
                return this.convertToCleanList(table);
            }
            
            if (prevMarkerType.includes('list-like-accordion')) {
                return this.convertToAccordionStyleList(table);
            }
            return this.convertToCleanList(table);
        },

        convertToCleanList: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            if (!rows.length) return '';
            
            let html = '<div class="responsive-list mobile-list-clean">';
            
            rows.forEach((row, rowIndex) => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length === 0) return;
                
                html += '<div class="list-item">';
                
                // Handle image cell
                const imageCell = cells[0];
                const contentCell = cells[1];
                
                if (imageCell) {
                    const img = imageCell.querySelector('img');
                    if (img) {
                        html += `<div class="list-image" style="text-align: center">${img.outerHTML}</div>`;
                    }
                }
                
                if (contentCell) {
                    // Handle title (text within <u> tags)
                    const title = contentCell.querySelector('u');
                    if (title) {
                        const titleText = this.cleanText(title.textContent);
                        html += `<div class="list-title">${titleText}</div>`;
                        
                        // Remove the title element temporarily to avoid processing its content again
                        const titleEl = title.closest('p');
                        if (titleEl) {
                            titleEl.remove();
                        }
                    }
                    
                    // Handle paragraphs (excluding empty ones)
                    contentCell.querySelectorAll('p').forEach(p => {
                        const text = this.cleanText(p.textContent);
                        if (text) {
                            html += `<div class="list-content">${text}</div>`;
                        }
                    });
                    
                    // Handle lists
                    const lists = contentCell.querySelectorAll('ul');
                    lists.forEach(ul => {
                        html += '<ul class="list-content">';
                        ul.querySelectorAll('li').forEach(li => {
                            const text = this.cleanText(li.textContent);
                            if (text) {
                                html += `<li>${text}</li>`;
                            }
                        });
                        html += '</ul>';
                    });
                }
                
                html += '</div>';
            });
            
            html += '</div>';
            return html;
        },
        
        convertToAccordionStyleList: function(table) {
            const items = this.convertTableToStructure(table);
            if (!items) return '';
        
            let html = '<div class="responsive-table-container">';  // Add proper container
            html += '<div class="responsive-list accordion-style">';
        
            items.forEach(item => {
                html += `
                    <div class="list-item">
                        <div class="list-content header">
                            <span class="article-header">${item.title}</span>
                        </div>`;
        
                item.content.forEach(content => {
                    switch (content.type) {
                        case 'mainHeader':
                        case 'subHeader':
                            html += `<div class="list-content subheader">${content.text}</div>`;
                            break;
                        case 'value':
                            html += `<div class="list-content value">${content.text}</div>`;
                            break;
                        case 'groupHeader':
                            html += `<div class="list-content group-header">${content.text}</div>`;
                            break;
                        case 'categoryHeader':
                            html += `<div class="list-content category-header">${content.text}</div>`;
                            break;
                    }
                });
        
                html += `</div>`;
            });
        
            html += '</div></div>';  // Close both containers
            return html;
        },


    // 10. Carousel-specific Methods
        determineCarouselType: function(table) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const firstColumnCells = Array.from(table.querySelectorAll('tr td:first-child'));
            const hasImagesInFirstColumn = firstColumnCells.some(cell => cell.querySelector('img'));
            const hasConsistentImageContentPattern = rows.every(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                return cells.length >= 2 && cells[0].querySelector('img') && cells[1].textContent.trim();
            });
        
            // Return row-based if we have images in first column and consistent pattern
            if (hasImagesInFirstColumn && hasConsistentImageContentPattern) {
                return 'row-based';
            }
        
            // Default to column-based for all other cases
            return 'column-based';
        },
        
        createRowBasedCarousel: function(table) {
            const rows = Array.from(table.querySelectorAll('tr')).filter(row => 
                row.querySelector('td')); // Only process rows with td elements

            const slides = rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (!cells.length) return null;

                // Combine cell contents into a single slide
                let slideContent = cells.map(cell => 
                    this.extractCellContent(cell)).join('');

                return slideContent ? { content: slideContent } : null;
            }).filter(Boolean); // Remove empty slides

            return this.createCarouselHTML(slides, 'row');
        },

        createColumnBasedCarousel: function(table) {
            const columns = [];
            const rows = Array.from(table.querySelectorAll('tr'));
            const numCols = rows[0].querySelectorAll('td').length;
            const hasArticleHeaders = !!table.querySelector('span.ArticleHeader');
        
            for (let colIndex = 0; colIndex < numCols; colIndex++) {
                let slideContent = '';
                let processedContent = new Set();
        
                rows.forEach((row) => {
                    const cell = row.querySelectorAll('td')[colIndex];
                    if (!cell) return;
        
                    // Handle images
                    const img = cell.querySelector('img');
                    if (img && !processedContent.has(img.outerHTML)) {
                        slideContent += `<div class="slide-image">${img.outerHTML}</div>`;
                        processedContent.add(img.outerHTML);
                    }
        
                    if (hasArticleHeaders) {
                        // Table 2 structure
                        const header = cell.querySelector('span.ArticleHeader');
                        if (header && !processedContent.has(header.textContent)) {
                            slideContent += `<div class="slide-header">${header.textContent}</div>`;
                            processedContent.add(header.textContent);
                        }
        
                        const link = cell.querySelector('a');
                        if (link && !processedContent.has(link.outerHTML)) {
                            slideContent += `<div class="slide-button">${link.outerHTML}</div>`;
                            processedContent.add(link.outerHTML);
                        }
                    } else {
                        // Table 1 structure
                        const paragraphs = Array.from(cell.querySelectorAll('p'));
                        paragraphs.forEach(p => {
                            const text = this.cleanText(p.textContent);
                            if (text && !processedContent.has(text)) {
                                slideContent += `<div class="slide-text">${text}</div>`;
                                processedContent.add(text);
                            }
                        });
        
                        // Handle direct text (like "test1")
                        if (!paragraphs.length) {
                            const directText = this.cleanText(cell.textContent);
                            if (directText && !processedContent.has(directText)) {
                                slideContent += `<div class="slide-text">${directText}</div>`;
                                processedContent.add(directText);
                            }
                        }
                    }
                });
        
                if (slideContent) {
                    columns.push({ content: slideContent });
                }
            }
        
            return this.createCarouselHTML(columns);
        },
        
        createCarouselHTML: function(items) {
            if (!items || !items.length) return '';
        
            let html = `
                <div class="carousel" data-carousel>
                    <div class="carousel-track" data-carousel-track>`;
        
            items.forEach((item, index) => {
                const content = typeof item.content === 'string' ? item.content : 
                            Array.isArray(item.content) ? item.content.join('') : '';
        
                html += `
                    <div class="carousel-slide" data-carousel-slide${index === 0 ? ' data-active="true"' : ''}>
                        <div class="slide-content">
                            ${content}
                        </div>
                    </div>`;
            });
        
            html += '</div>';
        
            // Add controls only if there are multiple slides
            if (items.length > 1) {
                html += `
                    <div class="carousel-controls">
                        <button class="carousel-btn prev" data-carousel-prev aria-label="Previous slide">
                            <svg viewBox="0 0 24 24">
                                <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                            </svg>
                        </button>
                        <div class="carousel-dots">
                            ${items.map((_, i) => `
                                <button class="carousel-dot${i === 0 ? ' active' : ''}" 
                                        data-carousel-dot="${i}"
                                        aria-label="Go to slide ${i + 1}">
                                </button>
                            `).join('')}
                        </div>
                        <button class="carousel-btn next" data-carousel-next aria-label="Next slide">
                            <svg viewBox="0 0 24 24">
                                <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                            </svg>
                        </button>
                    </div>`;
            }
        
            html += '</div>';
            return html;
        },

        addCarouselControls: function(html, numSlides) {
            if (!numSlides || numSlides <= 1) return html + '</div>';
        
            return html + 
                '<div class="carousel-controls">' +
                '<button class="carousel-btn prev" data-carousel-prev aria-label="Previous slide">' +
                '<svg viewBox="0 0 24 24">' +
                '<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
                '</svg>' +
                '</button>' +
                '<div class="carousel-dots">' +
                Array(numSlides).fill(0).map((_, i) => 
                    '<button class="carousel-dot' + (i === 0 ? ' active' : '') + '" ' +
                    'data-carousel-dot="' + i + '" ' +
                    'aria-label="Go to slide ' + (i + 1) + '"></button>'
                ).join('') +
                '</div>' +
                '<button class="carousel-btn next" data-carousel-next aria-label="Next slide">' +
                '<svg viewBox="0 0 24 24">' +
                '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
                '</svg>' +
                '</button>' +
                '</div>' +
                '</div>';
        },
        
        handleCarouselNavigation: function(carousel, direction) {
            const track = carousel.querySelector('[data-carousel-track]');
            const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
            const dots = Array.from(carousel.querySelectorAll('[data-carousel-dot]'));
            
            if (!track || !slides.length) return;
            
            const currentSlide = carousel.querySelector('[data-carousel-slide][data-active="true"]');
            const currentIndex = slides.indexOf(currentSlide);
            const totalSlides = slides.length;
            
            let newIndex;
            if (direction === 'prev') {
                newIndex = currentIndex === 0 ? totalSlides - 1 : currentIndex - 1;
            } else {
                newIndex = currentIndex === totalSlides - 1 ? 0 : currentIndex + 1;
            }
            
            track.style.transition = 'transform 0.5s ease-in-out';
            track.style.transform = `translateX(-${newIndex * 100}%)`;
            
            slides.forEach((slide, index) => {
                if (index === newIndex) {
                    slide.setAttribute('data-active', 'true');
                } else {
                    slide.removeAttribute('data-active');
                }
            });
            
            dots.forEach((dot, index) => {
                dot.classList.toggle('active', index === newIndex);
            });
            
            carousel._currentIndex = newIndex;
        },

        bindCarouselEvents: function(carousel) {
            if (!carousel) return;
        
            const track = carousel.querySelector('[data-carousel-track]');
            if (!track) return;
        
            track.addEventListener('touchstart', (e) => {
                carousel._touchStartX = e.touches[0].clientX;
                carousel._touchStartY = e.touches[0].clientY;
                track.style.transition = 'none';
            }, { passive: true });
        
            track.addEventListener('touchmove', (e) => {
                if (!carousel._touchStartX) return;
                
                const diffX = carousel._touchStartX - e.touches[0].clientX;
                const diffY = Math.abs(carousel._touchStartY - e.touches[0].clientY);
                
                if (diffY > Math.abs(diffX)) {
                    carousel._touchStartX = null;
                    return;
                }
                
                e.preventDefault();
                const moveX = -((carousel._currentIndex * 100) + ((diffX / track.offsetWidth) * 100));
                track.style.transform = `translateX(${moveX}%)`;
            }, { passive: false });
        
            track.addEventListener('touchend', (e) => {
                if (!carousel._touchStartX) return;
                
                const diffX = carousel._touchStartX - e.changedTouches[0].clientX;
                if (Math.abs(diffX) > 50) {
                    this.handleCarouselNavigation(carousel, diffX > 0 ? 'next' : 'prev');
                } else {
                    track.style.transform = `translateX(-${carousel._currentIndex * 100}%)`;
                }
                
                carousel._touchStartX = null;
                carousel._touchStartY = null;
                track.style.transition = 'transform 0.3s ease-in-out';
            }, { passive: true });
        },

        goToSlide: function(carousel, index) {
            const track = carousel.querySelector('[data-carousel-track]');
            const slides = Array.from(carousel.querySelectorAll('[data-carousel-slide]'));
            const dots = Array.from(carousel.querySelectorAll('[data-carousel-dot]'));
            
            if (!slides.length) return;
        
            // Normalize index
            const totalSlides = slides.length;
            const normalizedIndex = Math.max(0, Math.min(index, totalSlides - 1));
            
            // Update slides
            slides.forEach((slide, i) => {
                if (i === normalizedIndex) {
                    slide.setAttribute('data-active', '');
                } else {
                    slide.removeAttribute('data-active');
                }
            });
        
            // Update dots
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === normalizedIndex);
            });
        
            // Update track position with transition
            track.style.transition = 'transform 0.3s ease-in-out';
            track.style.transform = `translateX(-${normalizedIndex * 100}%)`;
            carousel._currentIndex = normalizedIndex;
        },


    // 11. Accordion-specific Methods
        handleAccordionClick: function(event) {
            const trigger = event.target.closest('[data-accordion-trigger]');
            if (!trigger) return;
            
            event.preventDefault();
            event.stopPropagation();
        
            const content = trigger.nextElementSibling;
            if (!content) return;
        
            // Close other accordions first
            const accordion = trigger.closest('[data-accordion]');
            if (accordion) {
                accordion.querySelectorAll('[data-accordion-trigger].active').forEach(otherTrigger => {
                    if (otherTrigger !== trigger) {
                        otherTrigger.classList.remove('active');
                        const otherContent = otherTrigger.nextElementSibling;
                        if (otherContent) {
                            otherContent.style.height = '0';
                            otherContent.classList.remove('active');
                        }
                    }
                });
            }
        
            // Toggle current accordion
            const isExpanding = !trigger.classList.contains('active');
            
            // Add/remove active class on trigger
            trigger.classList.toggle('active');
        
            // Handle content expansion/collapse
            if (isExpanding) {
                // First add active class to enable visibility
                content.classList.add('active');
                
                // Get height after content is visible
                const height = content.scrollHeight;
                
                // Set initial height to 0
                content.style.height = '0';
                
                // Force reflow
                content.offsetHeight;
                
                // Set target height
                content.style.height = `${height}px`;
            } else {
                // Set explicit height before collapsing
                content.style.height = `${content.scrollHeight}px`;
                
                // Force reflow
                content.offsetHeight;
                
                // Collapse
                content.style.height = '0';
                
                // Remove active class after transition
                setTimeout(() => {
                    if (!trigger.classList.contains('active')) {
                        content.classList.remove('active');
                    }
                }, 300); // Match transition duration
            }
        },


    // 12. Collapse-specific Methods
        handleCollapseButtonClick: function(event) {
            const button = event.target.closest(this.selectors.collapse.button);
            if (!button) return;
            
            event.preventDefault();
            event.stopPropagation();
            
            const content = button.nextElementSibling;
            if (!content || !content.matches(this.selectors.collapse.container)) return;
        
            // Store current state before toggling
            const wasActive = content.classList.contains('active');
            
            // Handle collapse
            if (!wasActive) {
                content.style.display = 'block';
                const height = content.scrollHeight;
                content.style.maxHeight = '0';
                content.offsetHeight; // Force reflow
                content.style.maxHeight = `${height}px`;
                content.classList.add('active');
                button.classList.add('active');
                
                // Update parent containers
                let parent = content.closest(`${this.selectors.collapse.container}${this.selectors.collapse.active}`);
                while (parent) {
                    parent.style.maxHeight = `${parent.scrollHeight + height}px`;
                    parent = parent.parentElement.closest(`${this.selectors.collapse.container}${this.selectors.collapse.active}`);
                }
            } else {
                content.style.maxHeight = '0';
                content.classList.remove('active');
                button.classList.remove('active');
                
                // Cleanup after transition
                setTimeout(() => {
                    if (!content.classList.contains('active')) {
                        content.style.display = 'none';
                    }
                }, 300);
            }
        },
        
        rebindEventHandlers: function() {
            this.log('Rebinding event handlers');
            
            // Remove all existing handlers
            this.removeAllEventListeners();
            
            // Reinitialize components to set up new handlers
            this.initializeComponents();
            
            // Ensure collapse states are correct
            document.querySelectorAll(this.selectors.collapse.container).forEach(container => {
                const isActive = container.classList.contains('active');
                container.style.display = isActive ? 'block' : 'none';
                container.style.maxHeight = isActive ? `${container.scrollHeight}px` : '0';
            });
        },
    

    // 13. Initialization and Setup
        initialize: function() {
            // Check if already initialized
            if (this.initialized) {
                this.log('Already initialized, skipping');
                return;
            }
        
            this.log('Starting initialization...', {
                viewport: window.innerWidth,
                breakpoint: this.mobileBreakpoint,
                isMobile: window.innerWidth < this.mobileBreakpoint
            });
        
            // Reset HTML storage on new initialization
            this.originalHtmlContent = null;
        
            // Set up media query listener
            this.mediaQuery = window.matchMedia(`(max-width: ${this.mobileBreakpoint}px)`);
            this.mediaQuery.addListener(this.handleViewportChange.bind(this));
        
            // Initialize mobile view if needed
            this._isMobileView = window.innerWidth < this.mobileBreakpoint;
            
            if (this._isMobileView) {
                this.enableMobileView();
            } else {
                this.log('Desktop mode - skipping table conversion');
            }
        
            // Initialize components
            this.initializeComponents();
        
            // Set up the observer to wait for content
            this.setupMutationObserver();
        
            this.initialized = true;
            this.log('Initialization complete');
        },
        
        initializeWithContainer: function(container) {
            if (!container || !container.matches(this.selectors.parentContainer)) {
                this.log('Invalid container for initialization');
                return;
            }
        
            this.log('Initializing with content container');
        
            // Store original HTML content
            const currentHtml = container.innerHTML;
            if (currentHtml.length > 0) {
                this.originalHtmlContent = currentHtml;
                this.log('Original content stored during initialization', {
                    length: this.originalHtmlContent.length,
                    firstChars: currentHtml.substring(0, 100) + '...'
                });
            } else {
                this.log('No content to store during initialization');
            }
        
            // Update mobile state immediately
            this._isMobileView = window.innerWidth < this.mobileBreakpoint;
            
            // Initialize components
            this.initializeComponents();
        
            if (this._isMobileView) {
                this.log('Starting in mobile view - enabling mobile conversions');
                this.enableMobileView();
            }
        },
        
        initializeComponents: function() {
            this.removeAllEventListeners();
            
            const eventHandler = (e) => {
                const collapseButton = e.target.closest(this.selectors.collapse.button);
                if (collapseButton) {
                    this.handleCollapseButtonClick.call(this, e);
                    return;
                }
        
                const carousel = e.target.closest('[data-carousel]');
                if (carousel) {
                    const prev = e.target.closest('[data-carousel-prev]');
                    const next = e.target.closest('[data-carousel-next]');
                    const dot = e.target.closest('[data-carousel-dot]');
                    
                    if (prev) {
                        e.preventDefault();
                        this.handleCarouselNavigation.call(this, carousel, 'prev');
                    } else if (next) {
                        e.preventDefault();
                        this.handleCarouselNavigation.call(this, carousel, 'next');
                    } else if (dot) {
                        e.preventDefault();
                        const index = parseInt(dot.getAttribute('data-carousel-dot'));
                        this.goToSlide.call(this, carousel, index);
                    }
                    return;
                }
        
                const accordionTrigger = e.target.closest('[data-accordion-trigger]');
                if (accordionTrigger) {
                    this.handleAccordionClick.call(this, e);
                }
            };
        
            document.removeEventListener('click', this._boundEventHandler);
            this._boundEventHandler = eventHandler.bind(this);
            document.addEventListener('click', this._boundEventHandler);
        
            // Initialize collapse states
            document.querySelectorAll(this.selectors.collapse.container).forEach(container => {
                if (container.classList.contains('active')) {
                    container.style.display = 'block';
                    container.style.maxHeight = `${container.scrollHeight}px`;
                    
                    let parent = container.closest(`${this.selectors.collapse.container}${this.selectors.collapse.active}`);
                    while (parent) {
                        parent.style.maxHeight = `${parent.scrollHeight}px`;
                        parent = parent.parentElement.closest(`${this.selectors.collapse.container}${this.selectors.collapse.active}`);
                    }
                } else {
                    container.style.maxHeight = '0';
                    container.style.display = 'none';
                }
            });
        
            // Initialize carousels with touch events
            document.querySelectorAll('[data-carousel]').forEach(carousel => {
                const track = carousel.querySelector('[data-carousel-track]');
                if (!track) return;
        
                carousel._currentIndex = 0;
        
                track.addEventListener('touchstart', (e) => {
                    track._touchStartX = e.touches[0].clientX;
                    track._touchStartY = e.touches[0].clientY;
                    track.style.transition = 'none';
                }, { passive: true });
                
                track.addEventListener('touchmove', (e) => {
                    if (!track._touchStartX) return;
                    
                    const diffX = track._touchStartX - e.touches[0].clientX;
                    const diffY = Math.abs(track._touchStartY - e.touches[0].clientY);
                    
                    if (diffY > Math.abs(diffX)) {
                        track._touchStartX = null;
                        return;
                    }
                    
                    e.preventDefault();
                    const moveX = -((carousel._currentIndex * 100) + ((diffX / track.offsetWidth) * 100));
                    track.style.transform = `translateX(${moveX}%)`;
                }, { passive: false });
                
                track.addEventListener('touchend', (e) => {
                    if (!track._touchStartX) return;
                    
                    const diffX = track._touchStartX - e.changedTouches[0].clientX;
                    if (Math.abs(diffX) > 50) {
                        this.handleCarouselNavigation(carousel, diffX > 0 ? 'next' : 'prev');
                    } else {
                        track.style.transform = `translateX(-${carousel._currentIndex * 100}%)`;
                    }
                    
                    track._touchStartX = null;
                    track._touchStartY = null;
                    track.style.transition = 'transform 0.3s ease-in-out';
                }, { passive: true });
            });
        
            // Initialize accordion states
            document.querySelectorAll('[data-accordion]').forEach(accordion => {
                const activeTrigger = accordion.querySelector('[data-accordion-trigger].active');
                if (activeTrigger) {
                    const content = activeTrigger.nextElementSibling;
                    if (content) {
                        content.style.height = `${content.scrollHeight}px`;
                        content.classList.add('active');
                    }
                }
            });
        },
        
        setupMutationObserver: function() {
            if (this.observer) {
                this.observer.disconnect();
            }
        
            this.observer = new MutationObserver((mutations) => {
                // Find content container
                const contentContainer = document.querySelector(this.selectors.parentContainer);
                
                if (contentContainer) {
                    const currentHtml = contentContainer.innerHTML;
                    
                    if (currentHtml.length > 100) {
                        // Store original content if not already stored
                        if (!this.originalHtmlContent || this.originalHtmlContent.length === 0) {
                            this.originalHtmlContent = currentHtml;
                            this.log('Content container HTML stored', {
                                length: this.originalHtmlContent.length,
                                firstChars: currentHtml.substring(0, 100) + '...'
                            });
                        }
        
                        // Process content if in mobile view, regardless of initialization state
                        if (this._isMobileView) {
                            // Process markers first
                            const state = this.getDefaultState();
                            this.processMarkers(contentContainer, state);
                            
                            // Then process any unprocessed tables
                            contentContainer.querySelectorAll('table:not([data-converted="true"])').forEach(table => {
                                if (!this.converted.has(table)) {
                                    const marker = this.findTableMarker(table);
                                    if (marker) {
                                        this.processTable(table, marker);
                                    }
                                }
                            });
        
                            // Reinitialize components
                            this.initializeComponents();
                        }
                    }
                }
            });
        
            // Set up the observer
            const observerTarget = document.querySelector('.html-wrapper') || document.body;
            this.observer.observe(observerTarget, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
        }
};


// Initialize when script loads
document.addEventListener('DOMContentLoaded', () => {
    window.TableConverter.log('DOMContentLoaded fired');
    window.TableConverter.cleanup(); // Clean up any existing state
    window.TableConverter.initialize();
});

// Handle cases where DOM is already loaded
if (document.readyState !== 'loading') {
    window.TableConverter.log('Document already loaded, initializing immediately');
    window.TableConverter.cleanup(); // Clean up any existing state
    window.TableConverter.initialize();
}

// Essential cleanup events for page transitions
window.addEventListener('beforeunload', () => {
    if (window.TableConverter) {
        window.TableConverter.log('beforeunload event triggered');
        window.TableConverter.cleanup();
    }
}, { capture: true });

window.addEventListener('pagehide', () => {
    if (window.TableConverter) {
        window.TableConverter.log('pagehide event triggered');
        window.TableConverter.cleanup();
    }
}, { capture: true });

// Add navigation event listener for single-page app transitions
window.addEventListener('popstate', () => {
    if (window.TableConverter) {
        window.TableConverter.log('popstate event triggered');
        window.TableConverter.cleanup();
        window.TableConverter.initialize();
    }
});

// Handle pushState/replaceState
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function() {
    originalPushState.apply(this, arguments);
    if (window.TableConverter) {
        window.TableConverter.log('pushState event triggered');
        window.TableConverter.cleanup();
        window.TableConverter.initialize();
    }
};

history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    if (window.TableConverter) {
        window.TableConverter.log('replaceState event triggered');
        window.TableConverter.cleanup();
        window.TableConverter.initialize();
    }
};
