const implementation = import('raw-body-esm').then(module => module.default);

function getRawBody(stream, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    if (typeof callback === 'function') {
        implementation.then(
            read => {
                try {
                    read(stream, options, callback);
                } catch (error) {
                    callback(error);
                }
            },
            error => callback(error)
        );
        return;
    }

    return implementation.then(read => read(stream, options));
}

module.exports = getRawBody;
