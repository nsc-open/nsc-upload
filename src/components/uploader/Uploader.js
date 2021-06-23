import React, { Component, useRef } from 'react'
import PropTypes from 'prop-types'
import { Icon, Button, message, Radio, Checkbox } from 'antd'
import Upload from './Upload'
import Dragger from './Dragger'
import { getUploadClient, encodeFileName, arrayMove, toFile, toAttachment, isDoc, imgSize } from './utils'
import { DndProvider, useDrag, useDrop, createDndContext } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import isEqual from 'lodash/isEqual'
import maxBy from 'lodash/maxBy'
import { Lightbox } from 'nsc-lightbox'
import co from './Co'
import Url from 'url-parse'
import './style/index.css'

const RNDContext = createDndContext(HTML5Backend)

const manager = useRef(RNDContext)

const sorter = (a, b) => a.sortNo - b.sortNo

class Uploader extends Component {
  constructor(props) {
    super(props)
    this.state = {
      listType: 'picture-card',
      fileList: [], // [{ id, name, encodeFileName, size, type, ext, uid, url }]
      OSSData: {},
      isBatch: false,
      selectedIds: [],
      indeterminate: true,
      checkAll: false,
    }
    this.uploadClient = null
  }

  componentDidMount() {
    const { defaultFiles, getOssParams, ossParams } = this.props
    if (getOssParams || (getOssParams && ossParams && (new Date(ossParams.Expiration) < Date.now()))) {
      getOssParams().then(r => {
        this.uploadClient = getUploadClient(r)
      })
    } else if (ossParams) {
      this.uploadClient = getUploadClient(ossParams)
    }
    this.setState({ fileList: defaultFiles.map(toFile).sort(sorter) })
  }

  componentWillReceiveProps(nextProps) {
    if (!isEqual(nextProps.defaultFiles, this.props.defaultFiles)) {
      this.setState({ fileList: nextProps.defaultFiles.map(toFile).sort(sorter) })
    }
  }

  handleCancel = () => this.setState({ previewVisible: false })

  onPreview = (file) => {
    const { onPreview } = this.props
    onPreview && onPreview(toAttachment(file))
  }

  handlePreview = (file) => {
    const { fileList } = this.state
    const files = fileList.map(toAttachment)
    const lightboxFiles = files.map((a) => {
      return { ...a, alt: a.name, uri: isDoc(a) ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(this.signatureUrl(a.uri))}` : this.signatureUrl(a.uri) }
    }
    )
    const lightboxIndex = (files.map(a => a.id).indexOf(file.id) || 0)
    this.setState({
      lightboxFiles,
      previewVisible: true,
      lightboxIndex
    })
  }

  signatureUrl = (url) => {
    url = decodeURIComponent(url)
    const { pathname } = new Url(decodeURIComponent(url))
    const fileName = pathname.substr(1)
    return this.uploadClient.signatureUrl(fileName)
  }

  onLightboxClose = () => {
    this.setState({ previewVisible: false })
  }


  handleChange = (file, fileList) => {
    const { onFileChange } = this.props
    onFileChange && onFileChange(toAttachment(file), fileList.map(toAttachment))
  }

  handleDownload = (file) => {
    const { onDownload } = this.props
    file.url = this.signatureUrl(file.url)
    onDownload && onDownload(toAttachment(file))
  }

  handleRemove = (file) => {
    const { autoSave, onRemove } = this.props
    const { fileList } = this.state
    const newFileList = fileList.filter(f => f.id !== file.id)

    this.setState({ fileList: newFileList })
    this.handleChange(file, newFileList)

    if (onRemove) {
      onRemove(toAttachment(file))
    }
  }

  save(file) {
    const { onSave } = this.props
    return onSave(toAttachment(file)).then(r => {
      message.success('上传成功')
      return toFile(r)
    }).catch(e => {
      console.error(e)
      message.error('上传失败')
    })
  }

  hasExtension = (fileName) => {
    const { fileExtension } = this.props
    const extensions = fileExtension ? fileExtension : []
    const pattern = '(' + extensions.join('|').replace(/\./g, '\\.') + ')$';
    return new RegExp(pattern, 'i').test(fileName);
  }

  //文件先上传至阿里云
  beforeUpload = async (file, files) => {
    const { autoSave, maxFileSize, maxFileNum, fileExtension, uploadType, fileErrorMsg, onProgress, fileScales } = this.props
    const { fileList } = this.state
    //Check for file extension
    if (fileExtension && !this.hasExtension(file.name)) {
      message.error(fileErrorMsg && fileErrorMsg.fileExtensionErrorMsg ? fileErrorMsg.fileExtensionErrorMsg : `不支持的文件格式，请上传格式为${fileExtension.join(',')}的文件`)
      return false
    }
    // Check for file size
    if (file.size / 1024 / 1024 > maxFileSize) {
      message.error(fileErrorMsg && fileErrorMsg.fileSizeErrorMsg ? fileErrorMsg.fileSizeErrorMsg : `文件过大，最大可上传${maxFileNum}`)
      return false
    }
    // Check for file number
    if (files.length + fileList.length > maxFileNum) {
      message.error(fileErrorMsg && fileErrorMsg.fileNumerErrorMsg ? fileErrorMsg.fileNumerErrorMsg : `文件数量过多，最多可上传${maxFileNum}份`)
      return false
    }
    // Check for file scale
    if (fileScales) {
      let isScale = true
      await imgSize(file, fileScales).then(r => {
        if (!r) {
          message.error(fileErrorMsg && fileErrorMsg.fileNumerErrorMsg ? fileErrorMsg.fileScaleErrorMsg : `添加失败: ${file.name} - 错误的图片尺寸 (请使用${fileScales.join(':1 或')}:1的图片)`)
          isScale = false
        }
      })
      if (!isScale) {
        return false
      }
    }
  }

  uploadFile = ({ file }) => {

    const { autoSave, maxFileSize, maxFileNum, fileExtension, uploadType, fileErrorMsg, onProgress, fileScales } = this.props
    const { fileList } = this.state
    let encodedFileName = encodeFileName(file.name)
    const maxItem = maxBy(fileList, i => i.sortNo)
    const maxSortNo = maxItem ? maxItem.sortNo : 0
    // const indexNo = fileList.findIndex(i => i.uid === file.uid)

    const newItem = {
      uid: file.uid,
      id: file.uid,
      encodedFileName,
      name: file.name,
      percent: 0,
      url: '',
      status: 'uploading',
      size: file.size,
      ext: file.name.split('.').pop(),
      type: file.type,
      sortNo: maxSortNo + 1
    }
    if (uploadType !== 'multiple') {
      const newFileList = fileList.concat([newItem])
      newFileList.sort(sorter)
      this.setState({ fileList: newFileList })
    }

    // start：进度条相关
    if (this.uploadClient) {
      const _ = this
      const progress = function* generatorProgress(p, cpt, aliRes) {
        // const indexNo = files.findIndex(i => i.uid === file.uid)
        const requestUrl = aliRes && aliRes.res && aliRes.res.requestUrls ? aliRes.res.requestUrls[0] : ''
        const { origin } = new Url(decodeURIComponent(requestUrl))
        const url = cpt ? origin + "/" + aliRes.name : ''
        const newItem = {
          uid: file.uid,
          id: file.uid,
          encodedFileName,
          name: file.name,
          percent: p * 100,
          url,
          status: p === 1 ? 'done' : 'uploading',
          size: file.size,
          ext: file.name.split('.').pop(),
          type: file.type,
          sortNo: maxSortNo + 1
        }
        // console.log('newItem', newItem)

        const newFileList = _.state.fileList.filter(i => i.uid !== file.uid).concat([newItem])
        newFileList.sort(sorter)
        _.setState({ fileList: newFileList })
        onProgress && onProgress(p, cpt, aliRes)
      }

      const options = {
        progress,
        partSize: 1000 * 1024,//设置分片大小
        timeout: 120000000,//设置超时时间
      }
      const _this = this

      co(function* () {
        return yield _this.uploadClient.multipartUpload(encodedFileName, file, options)
      }).then(aliRes => {
        const requestUrl = aliRes && aliRes.res && aliRes.res.requestUrls ? aliRes.res.requestUrls[0] : ''
        const { origin } = new Url(decodeURIComponent(requestUrl))
        const url = origin + "/" + aliRes.name
        // const indexNo = files.findIndex(i => i.uid === file.uid)
        onProgress && onProgress(aliRes)
        const newFile = {
          uid: file.uid,
          id: file.uid,
          encodedFileName,
          name: file.name,
          url,
          percent: 100,
          status: 'done',
          size: file.size,
          ext: file.name.split('.').pop(),
          type: file.type,
          sortNo: maxSortNo + 1
        }
        const newFileList = _.state.fileList.filter(i => i.uid !== file.uid).concat([newFile])
        newFileList.sort(sorter)
        this.setState({ fileList: newFileList })
        this.handleChange(newFile, newFileList)
        if (autoSave) {
          this.save(newFile)
        } else {
          return newFile
        }
      }).catch(e => {
        console.error('Uploader error', e)
        message.error(`${file.name} 预处理失败`)
      })
      // not do the upload after image added
      return false
    }
  }

  onSortEnd = (sourceIndex, destinationIndex) => {
    const { onSortEnd } = this.props
    if (sourceIndex) {
      const newFileList = arrayMove(this.state.fileList, sourceIndex, destinationIndex)
      this.setState({ fileList: newFileList });
      onSortEnd && onSortEnd(this.state.fileList.map(toAttachment), newFileList.map(toAttachment))
    }

  }

  onListTypeChange = (e) => {
    this.setState({ listType: e.target.value })
  }

  renderRadio = (showRadioButton) => {
    const defaultRadioItems = [
      { key: 'picture-card', value: '网格' },
      { key: 'text', value: '列表' },
      { key: 'picture', value: '图片列表' },
    ]
    const { placement = 'right', showRadioTitle = true, radioItems = defaultRadioItems } = showRadioButton
    return <div className={`nsc-uploader-radio nsc-uploader-radio-${placement}`}>
      {showRadioTitle && <span>文件展示样式：</span>}
      <Radio.Group onChange={this.onListTypeChange} value={this.state.listType}>
        {radioItems && radioItems.map(item => <Radio key={item.key} value={item.key}>{item.value}</Radio>)}
      </Radio.Group>
    </div>
  }

  onBatchClicked = () => {
    const { isBatch } = this.state
    this.setState({ isBatch: !isBatch, selectedIds: [], checkAll: false, indeterminate: true })
  }

  onBatchDelete = () => {
    const { selectedIds } = this.state
    if (selectedIds.length > 0) {
      const { autoSave, onRemove } = this.props
      const { fileList } = this.state
      const newFileList = fileList.filter(f => !selectedIds.includes(f.uid))

      this.setState({ fileList: newFileList })

      if (onRemove) {
        onRemove(newFileList.map(toAttachment))
      }
    }

  }

  onSelected = selectedIds => {
    const plainOptions = this.state.fileList.map(i => i.uid)
    this.setState({
      selectedIds,
      indeterminate: !!selectedIds.length && selectedIds.length < plainOptions.length,
      checkAll: selectedIds.length === plainOptions.length,
    })
  }

  onCheckAllChange = e => {
    const plainOptions = this.state.fileList.map(i => i.uid)
    this.setState({
      selectedIds: e.target.checked ? plainOptions : [],
      indeterminate: false,
      checkAll: e.target.checked,
    })
  }

  render() {
    const { fileList, previewVisible, lightboxFiles, lightboxIndex, isBatch, selectedIds, indeterminate, checkAll } = this.state
    const {
      dragSortable,
      beforeUpload,
      type,
      maxFileNum,
      disabled,
      children,
      className = '',
      showUploadButton,
      customRadioButton,
      showBatchButton,
      ...restProps
    } = this.props

    const listType = this.props.listType ? this.props.listType : this.state.listType

    const showRadioButton = this.props.listType ? false : this.props.showRadioButton
    const props = {/*  */
      ...restProps,
      fileList: fileList,
      listType: listType,
      beforeUpload: this.beforeUpload,
      customRequest: this.uploadFile,
      dragSortable: dragSortable,
      disabled: disabled,
      onSortEnd: this.onSortEnd,
      className: showUploadButton ? `${className}` : type === 'dragger' ? `${className} nsc-uploader-dragger-hide` : `${className}`,
      onPreview: 'onPreview' in this.props ? this.props.onPreview : this.handlePreview,
      onRemove: this.handleRemove,
      onDownload: this.handleDownload,
      signatureUrl: this.signatureUrl,
      onSelected: this.onSelected,
      selectedIds,
      isBatch,
    }
    //文件列表按上传顺序排序
    fileList.sort(sorter)

    //listType === "picture-card"时 默认上传按钮
    const cardButton = (
      <div>
        <Icon type="plus" />
        <div className="uploadText">上传文件</div>
      </div>
    );

    //listType === "text' 或 'picture"时默认上传按钮
    const textButton = (
      <Button>
        <Icon type="upload" /> 上传文件
      </Button>
    );

    //拖动上传时默认上传按钮
    const draggerBtn = (
      <div>
        <p className="ant-upload-drag-icon">
          <Icon type="inbox" style={{ color: '#3db389' }} />
        </p>
        <p className="ant-upload-text">点击获取拖动 图片或文档 到这块区域完成文件上传</p>
      </div>
    )

    const uploader = type === 'dragger' ?
      <Dragger {...props} >
        {showUploadButton ? children ? children : maxFileNum in this.props && fileList.length >= maxFileNum ? null : draggerBtn : null}
      </Dragger>
      : <DndProvider manager={manager.current.dragDropManager}>
        <Upload {...props}>
          {showUploadButton ? children ? children : maxFileNum in this.props && fileList.length >= maxFileNum ? null : listType === 'picture-card' ? cardButton : textButton : null}
        </Upload>
      </DndProvider>

    return (
      <div className='nsc-upload-container'>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {customRadioButton ? customRadioButton : showRadioButton ? this.renderRadio(showRadioButton) : null}
          {showBatchButton &&
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {isBatch && <Checkbox indeterminate={indeterminate} onChange={this.onCheckAllChange} checked={checkAll}> 全选</Checkbox >}
              <Button type="primary" onClick={this.onBatchClicked} style={{ marginRight: '10px' }}>
                {isBatch
                  ? `取消选择(${selectedIds.length})`
                  : '批量选择'}
              </Button>
              {isBatch && <Button type="danger" onClick={this.onBatchDelete}>批量删除</Button>}
            </div>
          }
        </div>
        {dragSortable ?
          <DndProvider manager={manager.current.dragDropManager}>
            {uploader}
          </DndProvider>
          : uploader
        }
        {previewVisible && lightboxFiles.length > 0 && <Lightbox
          visible={previewVisible}
          imgvImages={lightboxFiles}
          activeIndex={lightboxIndex}
          onCancel={this.onLightboxClose}
        />
        }
      </div>
    );
  }
}

Uploader.propTypes = {
  getOssParams: PropTypes.func,
}

Uploader.defaultProps = {
  dragSortable: false,
  defaultFiles: [],
  multiple: false,
  type: 'select',
  uploadType: 'multiple',
  showUploadButton: true,
  showRadioButton: true,
  showBatchButton: true,
}

export default Uploader
