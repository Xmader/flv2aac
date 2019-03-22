// @ts-check

// import FLVDemuxer from "./flvdemuxer.js"
const FLVDemuxer = require("./flvdemuxer.js")

/**
 * 计算adts头部
 * @see https://blog.jianchihu.net/flv-aac-add-adtsheader.html
 * @typedef {Object} AdtsHeadersInit
 * @property {number} audioObjectType
 * @property {number} samplingFrequencyIndex
 * @property {number} channelConfig
 * @property {number} adtsLen
 * @param {AdtsHeadersInit} init 
 */
const getAdtsHeaders = (init) => {
    const { audioObjectType, samplingFrequencyIndex, channelConfig, adtsLen } = init
    const headers = new Uint8Array(7)

    headers[0] = 0xff         //syncword:0xfff                          高8bits
    headers[1] = 0xf0         //syncword:0xfff                          低4bits
    headers[1] |= (0 << 3)    //MPEG Version:0 for MPEG-4,1 for MPEG-2  1bit
    headers[1] |= (0 << 1)    //Layer:0                                 2bits 
    headers[1] |= 1           //protection absent:1                     1bit

    headers[2] = (audioObjectType - 1) << 6            //profile:audio_object_type - 1                      2bits
    headers[2] |= (samplingFrequencyIndex & 0x0f) << 2 //sampling frequency index:sampling_frequency_index  4bits 
    headers[2] |= (0 << 1)                             //private bit:0                                      1bit
    headers[2] |= (channelConfig & 0x04) >> 2           //channel configuration:channel_config               高1bit

    headers[3] = (channelConfig & 0x03) << 6    //channel configuration:channel_config      低2bits
    headers[3] |= (0 << 5)                      //original：0                               1bit
    headers[3] |= (0 << 4)                      //home：0                                   1bit
    headers[3] |= (0 << 3)                      //copyright id bit：0                       1bit  
    headers[3] |= (0 << 2)                      //copyright id start：0                     1bit

    headers[3] |= (adtsLen & 0x1800) >> 11      //frame length：value   高2bits
    headers[4] = (adtsLen & 0x7f8) >> 3         //frame length:value    中间8bits 
    headers[5] = (adtsLen & 0x7) << 5           //frame length:value    低3bits
    headers[5] |= 0x1f                          //buffer fullness:0x7ff 高5bits 
    headers[6] = 0xfc

    return headers
}

/**
 * Demux FLV into H264 + AAC stream into line stream then
 * remux it into a AAC file.
 * @param {Blob|Buffer|ArrayBuffer} flv 
 */
const FLV2AAC = async (flv) => {

    // load flv as arraybuffer
    /** @type {ArrayBuffer} */
    const flvArrayBuffer = await new Promise((r, j) => {
        if ((typeof Blob != "undefined") && (flv instanceof Blob)) {
            const reader = new FileReader()
            reader.onload = () => {
                /** @type {ArrayBuffer} */
                // @ts-ignore
                const result = reader.result
                r(result)
            }
            reader.onerror = j
            reader.readAsArrayBuffer(flv)
        } else if ((typeof Buffer != "undefined") && (flv instanceof Buffer)) {
            r(new Uint8Array(flv).buffer)
        } else if (flv instanceof ArrayBuffer) {
            r(flv)
        } else {
            j(new TypeError("@type {Blob|Buffer|ArrayBuffer} flv"))
        }
    })

    const flvProbeData = FLVDemuxer.probe(flvArrayBuffer)
    const flvDemuxer = new FLVDemuxer(flvProbeData)

    /**
     * @typedef {Object} Sample
     * @property {Uint8Array} unit
     * @property {number} length
     * @property {number} dts
     * @property {number} pts
     */

    /** @type {{ type: "audio"; id: number; sequenceNumber: number; length: number; samples: Sample[]; }} */
    let aac = null
    let metadata = null

    flvDemuxer.onTrackMetadata = (type, _metaData) => {
        if (type == "audio") {
            metadata = _metaData
        }
    }

    flvDemuxer.onMediaInfo = () => { }

    flvDemuxer.onError = (e) => {
        throw new Error(e)
    }

    flvDemuxer.onDataAvailable = (...args) => {
        args.forEach(data => {
            if (data.type == "audio") {
                aac = data
            }
        })
    }

    const finalOffset = flvDemuxer.parseChunks(flvArrayBuffer, flvProbeData.dataOffset)
    if (finalOffset != flvArrayBuffer.byteLength) {
        throw new Error("FLVDemuxer: unexpected EOF")
    }

    const {
        audioObjectType,
        samplingFrequencyIndex,
        channelCount: channelConfig
    } = metadata

    /** @type {number[]} */
    let output = []

    aac.samples.forEach((sample) => {
        const headers = getAdtsHeaders({
            audioObjectType,
            samplingFrequencyIndex,
            channelConfig,
            adtsLen: sample.length + 7
        })
        output.push(...headers, ...sample.unit)
    })

    return new Uint8Array(output)
}

module.exports = FLV2AAC

const _UNIT_TEST = async () => {
    const fs = require("fs").promises
    const data = await fs.readFile("test/test.flv")
    const output = await FLV2AAC(data)
    await fs.writeFile("./output.aac", output)
}
