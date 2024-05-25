const fs = require('fs');

const filesystem = () => {
    const _delete = async (filelist) =>
        await Promise.all(filelist.map(async (file) => {
            await fs.promises.unlink(file)
                .catch(e => console.warn(`Deletion failure`, e))
        }))

    const del = (files) => {
        return Array.isArray(files) ? _delete(files)
            : _delete([files]);
    }

    return Object.freeze({
        del
    });
};

export default filesystem;