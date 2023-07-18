import _ from 'lodash';

const component = (document) => {
        const element = document.createElement('div');

        // Lodash, currently included via a script, is required for this line to work
        element.innerHTML = _.join(['Hello', 'webpack'], ' ');

        return element;
};

document.body.appendChild(component(document));
