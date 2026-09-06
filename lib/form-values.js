// Only copy named scalar fields; request objects must never become render options.
function formString(value) {
    return typeof value === 'string' ? value : '';
}

function pickStrings(input, fields) {
    const values = Object.create(null);
    for (const field of fields) {
        if (input && Object.prototype.hasOwnProperty.call(input, field) && typeof input[field] === 'string') {
            values[field] = input[field];
        }
    }
    return values;
}

function accountFormValues(input) {
    return pickStrings(input, [
        'name', 'email', 'country', 'state', 'phone', 'dateOfBirth',
        'interests', 'experience', 'policyAccepted', 'termsAccepted'
    ]);
}

function teamFormValues(input) {
    return pickStrings(input, [
        'registrationMode', 'program', 'teamNumber', 'name', 'contact',
        'country', 'state', 'city', 'address', 'notes', 'awards',
        'yearsInProgram', 'recruiting'
    ]);
}

function signupView(mode) {
    return mode === 'manager' ? 'pages/signup-manager' : 'pages/signup-seeker';
}

module.exports = { formString, accountFormValues, teamFormValues, signupView };
