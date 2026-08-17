// inject.js
(function() {

    // Intercept Fetch API
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0] instanceof Request ? args[0].url : args[0];
        
        // Listen for Yango Fleet API endpoints related to metrics, trips, or statements
        if (url.includes('/api/') && (url.includes('metrics') || url.includes('trips') || url.includes('earnings') || url.includes('transactions'))) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                
                // Send the raw JSON data back to content.js
                window.postMessage({
                    type: 'YANGO_API_INTERCEPT',
                    url: url,
                    data: data
                }, window.location.origin);
            } catch (e) {
                console.error("Fleet Extension: Failed to parse intercept data", e);
            }
        }
        return response;
    };

    // Intercept XHR (if Yango uses older XMLHttpRequest for some calls)
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function(method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function() {
        this.addEventListener('load', function() {
            if (this._url.includes('/api/') && (this._url.includes('metrics') || this._url.includes('trips'))) {
                try {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({
                        type: 'YANGO_API_INTERCEPT',
                        url: this._url,
                        data: data
                    }, window.location.origin);
                } catch (e) {
                    // Not JSON or parse error
                }
            }
        });
        return send.apply(this, arguments);
    };
})();