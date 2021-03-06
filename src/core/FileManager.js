const fs = require('fs');
const watch = require('node-watch');
const { EventEmitter } = require('events');
const Image = require('core/Image');

class FileManager extends EventEmitter{
    constructor(App) {
        super();

        /**
         * The app for the file manager
         */
        Object.defineProperty(this, 'app', {value: App});

        /**
         * The current list of files/images on the disk
         * @type {array}
         */
        this.currentImageFileListDisk = [];

        this._fileChangeHandler = this._fileChangeHandler.bind(this);
    }

    /**
     * Initialize the file manager
     */
    async init() {
        this.app.logger.info('Starting File Manager');


        await this.populateDiskImageFileList();

        this.app.logger.info('Started File Manager');
    }

    /**
     * Starts watching the file system for changes parses them to the event emitter
     */
    async _startWatchingFileChanges() {
        return new Promise((resolve) => {
            watch(this.app.config.assetDirectory, {
                persistent: true, 
                recursive: true,
                filter: name => name.endsWith('.jpg')
            }, this._fileChangeHandler).on('ready', () => {
                this.app.logger.info('Started watching for file changes');
                resolve();
            })
        })
    }

    async _fileChangeHandler(event, file) {
        file = file.split('\\').join('/');
        if(file.endsWith('-watermarked.jpg')) return;

        const imageInfo = {
            path: file,
            relativePath: file.substring(this.app.config.assetDirectory.length, file.length),
            fileName: file.substring(file.lastIndexOf('/')+1, file.length)
        }

        const eventType = event === 'update' ? 'fileUpdate' : 'fileDelete';
        //console.log(file, eventType)
        let image;
        if(await this.fileExists(imageInfo.path)) image = await Image.build(Object.assign({}, imageInfo)); //if file exists build image

        if(image && imageInfo.fileName.startsWith('$') && image._contentfulImageId === '' && eventType === 'fileUpdate') {
            this.currentImageFileListDisk.push({
                ...imageInfo,
                contentfulImageId: image._contentfulImageId,
                imageHash: image._imageHash
            });
            return this.emit('fileNew', image);
        }  

        for(let i=0; i<this.currentImageFileListDisk.length; i++) {
            if(!image && eventType === 'fileDelete' && this.currentImageFileListDisk[i].path === imageInfo.path) return this.emit('fileDelete', this.currentImageFileListDisk.splice(i, 1)[0]); //delete file
            
            if(eventType === "fileUpdate" && this.currentImageFileListDisk[i].contentfulImageId === image._contentfulImageId) { //already known file on disk
                if(this.currentImageFileListDisk[i].path !== image.path && await this.fileExists(this.currentImageFileListDisk[i].path)) return;

                if(this.currentImageFileListDisk[i].imageHash === image._imageHash) { //image content same, same hash
                    if(this.currentImageFileListDisk[i].fileName.substring(1, this.currentImageFileListDisk[i].fileName.length) === imageInfo.fileName) return this.emit('fileDelete', this.currentImageFileListDisk.splice(i, 1)[0]); //delete file, $ removed

                    this.currentImageFileListDisk.splice(i, 1, {...imageInfo, contentfulImageId: image._contentfulImageId, imageHash: image._imageHash}); //update image info
                    return this.emit('fileNameUpdate', image); //name change
                }

                this.currentImageFileListDisk.splice(i, 1, {...imageInfo, contentfulImageId: image._contentfulImageId, imageHash: image._imageHash}); //update image info
                return this.emit('fileContentUpdate', image); //Content update
            }
        }

        if(image && imageInfo.fileName.startsWith('$') && !(await this.app.contentful.getAsset(image._contentfulImageId)) && eventType === 'fileUpdate') { //Is new file but has been in contentful
            this.currentImageFileListDisk.push({
                ...imageInfo,
                contentfulImageId: image._contentfulImageId,
                imageHash: image._imageHash
            });
            return this.emit('fileNew', image);
        }
    }

    /**
     * Updates the disk file list with the current files on disk
     */
    async populateDiskImageFileList() {
        this.currentImageFileListDisk = await this.getImageFileList(this.app.config.assetDirectory, '');
        this.app.logger.info(`Disk Image File List Populated With ${this.currentImageFileListDisk.length} Images`, {currentImageFileListDisk: this.currentImageFileListDisk});
        return;
    }

    /**
     * Gets a list of images in a particular folder and subfolders
     * @param {string} searchPath 
     * @param {string} relativePath 
     */
    async getImageFileList(searchPath, relativePath) {
        let images = [];
        let data;
        try {
            data = await this.readDir(searchPath);
        } catch(e) {
            throw e;
        }

        for(let i=0; i<data.length; i++) {
            const item = data[i];
            //if(images.length > 4) continue;
            if(item.indexOf('.') !== -1) {
                if(item.endsWith('.jpg') && item.startsWith('$')) {
                    const imageInfo = {
                        path: `${searchPath}/${item}`,
                        relativePath: `${relativePath}/${item}`,
                        fileName: item
                    };
                    //Use object assign to copy variables and allow the image data to be garbage collected
                    const image = await Image.build(Object.assign({}, imageInfo));
                    images.push(Object.assign({}, imageInfo, {
                        contentfulImageId: image._contentfulImageId,
                        imageHash: image._imageHash
                    }));
                }
                continue;
            }
            if(relativePath === '' && item === 'watermarked') continue;
            images.push(...await this.getImageFileList(`${searchPath}/${item}`, `${relativePath}/${item}`));
        }
        return images;
    }

    /**
     * Checks if a file exists on the file system
     * @param {string} path 
     */
    async fileExists(path) {
        return new Promise((resolve) => {
            fs.access(path, fs.constants.F_OK, (err) => {
                resolve(!err);
            })
        })
    }

    /**
     * Reads the current files and directories in a directory
     * @param {string} path 
     */
    async readDir(path) {
        return new Promise((resolve, reject) => {
            fs.readdir(path, (err, data) => {
                if(err) return reject(err);
                return resolve(data);
            });
        })
    }
}

module.exports = FileManager;