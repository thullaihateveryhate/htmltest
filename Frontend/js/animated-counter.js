/**
 * Stockd Animated Counter Utility
 * Creates smooth counting animations for numeric values
 */

class AnimatedCounter {
    /**
     * Animate a number from start to end value
     * @param {HTMLElement} element - The DOM element to update
     * @param {number} endValue - The target value
     * @param {Object} options - Configuration options
     */
    static animate(element, endValue, options = {}) {
        const {
            startValue = 0,
            duration = null, // Auto-calculate if not provided
            prefix = '',
            suffix = '',
            decimals = 0,
            useGrouping = true, // Add commas for thousands
            easing = 'easeOutExpo'
        } = options;

        // Auto-calculate duration based on magnitude
        let animDuration = duration;
        if (!animDuration) {
            const magnitude = Math.abs(endValue);
            if (magnitude <= 100) animDuration = 1000;
            else if (magnitude <= 10000) animDuration = 1500;
            else animDuration = 2000;
        }

        const startTime = performance.now();
        const diff = endValue - startValue;

        // Easing functions
        const easings = {
            easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
            easeOutQuart: t => 1 - Math.pow(1 - t, 4),
            easeOutCubic: t => 1 - Math.pow(1 - t, 3),
            easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        };

        const easingFn = easings[easing] || easings.easeOutExpo;

        const formatNumber = (num) => {
            const formatted = num.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
                useGrouping: useGrouping
            });
            return `${prefix}${formatted}${suffix}`;
        };

        const step = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / animDuration, 1);
            const easedProgress = easingFn(progress);
            const currentValue = startValue + (diff * easedProgress);

            element.textContent = formatNumber(currentValue);

            if (progress < 1) {
                requestAnimationFrame(step);
            }
        };

        requestAnimationFrame(step);
    }

    /**
     * Animate currency value
     * @param {HTMLElement} element - The DOM element
     * @param {number} value - The target value
     * @param {Object} options - Additional options
     */
    static animateCurrency(element, value, options = {}) {
        this.animate(element, value, {
            prefix: '$',
            decimals: options.decimals !== undefined ? options.decimals : 2,
            ...options
        });
    }

    /**
     * Animate percentage value
     * @param {HTMLElement} element - The DOM element
     * @param {number} value - The target value
     * @param {Object} options - Additional options
     */
    static animatePercentage(element, value, options = {}) {
        this.animate(element, value, {
            suffix: '%',
            decimals: options.decimals !== undefined ? options.decimals : 1,
            ...options
        });
    }

    /**
     * Animate a value with a unit suffix
     * @param {HTMLElement} element - The DOM element
     * @param {number} value - The target value
     * @param {string} unit - The unit suffix (e.g., 'oz', 'items')
     * @param {Object} options - Additional options
     */
    static animateWithUnit(element, value, unit, options = {}) {
        this.animate(element, value, {
            suffix: ` ${unit}`,
            decimals: options.decimals !== undefined ? options.decimals : 0,
            ...options
        });
    }

    /**
     * Animate a delta value (with + or - prefix)
     * @param {HTMLElement} element - The DOM element
     * @param {number} value - The target value (can be negative)
     * @param {string} unit - The unit suffix
     * @param {Object} options - Additional options
     */
    static animateDelta(element, value, unit = '', options = {}) {
        const sign = value >= 0 ? '+' : '';
        this.animate(element, value, {
            prefix: sign,
            suffix: unit ? ` ${unit}` : '',
            decimals: options.decimals !== undefined ? options.decimals : 2,
            ...options
        });
    }

    /**
     * Parse a formatted number string and animate from 0
     * @param {HTMLElement} element - The DOM element containing formatted number
     */
    static animateFromText(element) {
        const text = element.textContent || '';

        // Detect format
        const hasDollar = text.includes('$');
        const hasPercent = text.includes('%');
        const hasPlus = text.startsWith('+');

        // Extract number
        let numStr = text.replace(/[$,%+\s]/g, '').replace(/[a-zA-Z]/g, '');
        const num = parseFloat(numStr) || 0;

        // Count decimals
        const decimalMatch = numStr.match(/\.(\d+)/);
        const decimals = decimalMatch ? decimalMatch[1].length : 0;

        // Extract unit (letters at end)
        const unitMatch = text.match(/[\d.]+\s*([a-zA-Z]+)/);
        const unit = unitMatch ? unitMatch[1] : '';

        if (hasDollar) {
            this.animateCurrency(element, num, { decimals });
        } else if (hasPercent) {
            this.animatePercentage(element, num, { decimals });
        } else if (unit) {
            this.animateWithUnit(element, num, unit, { decimals });
        } else if (hasPlus || text.startsWith('-')) {
            this.animateDelta(element, hasPlus ? num : -num, '', { decimals });
        } else {
            this.animate(element, num, { decimals });
        }
    }
}

// Make available globally
window.AnimatedCounter = AnimatedCounter;

// Helper function for easy use
window.animateNumber = (element, value, options) => AnimatedCounter.animate(element, value, options);
window.animateCurrency = (element, value, options) => AnimatedCounter.animateCurrency(element, value, options);
window.animatePercentage = (element, value, options) => AnimatedCounter.animatePercentage(element, value, options);
