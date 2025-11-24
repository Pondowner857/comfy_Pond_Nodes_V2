import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "RemoteWorkflow.FileUploadSelector",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "RemoteWorkflowExecutor") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function() {
                const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                const node = this;
                
                let enabledNodes = {};
                let workflowNodes = [];
                let workflowData = null;
                let outputTypes = {image: false, text: false, audio: false, video: false};
                
                const workflowFileWidget = node.widgets?.find(w => w.name === "workflow_file");
                const selectedNodesWidget = node.widgets?.find(w => w.name === "selected_nodes");
                const savedStateWidget = node.widgets?.find(w => w.name === "saved_state");
                const ipWidget = node.widgets?.find(w => w.name === "remote_ip");
                const portWidget = node.widgets?.find(w => w.name === "remote_port");
                
                if (!workflowFileWidget || !selectedNodesWidget || !savedStateWidget || !ipWidget || !portWidget) {
                    return result;
                }
                
                if (!workflowFileWidget.value) workflowFileWidget.value = "";
                if (!selectedNodesWidget.value) selectedNodesWidget.value = "{}";
                if (!savedStateWidget.value) savedStateWidget.value = "{}";
                if (!ipWidget.value) ipWidget.value = "192.168.1.100";
                if (!portWidget.value) portWidget.value = 8188;
                
                const saveState = () => {
                    try {
                        const state = {
                            workflow_nodes: workflowNodes,
                            output_types: outputTypes,
                            enabled_nodes: enabledNodes,
                            timestamp: Date.now()
                        };
                        savedStateWidget.value = JSON.stringify(state);
                    } catch (e) {}
                };
                
                const restoreState = () => {
                    try {
                        if (workflowFileWidget.value && workflowFileWidget.value !== "") {
                            try {
                                workflowData = JSON.parse(workflowFileWidget.value);
                            } catch (e) {}
                        }
                        
                        const stateStr = savedStateWidget.value;
                        if (stateStr && stateStr !== "{}") {
                            const savedState = JSON.parse(stateStr);
                            
                            if (savedState.workflow_nodes) workflowNodes = savedState.workflow_nodes;
                            if (savedState.output_types) outputTypes = savedState.output_types;
                            if (savedState.enabled_nodes) enabledNodes = savedState.enabled_nodes;
                            
                            return workflowNodes.length > 0;
                        }
                    } catch (e) {}
                    return false;
                };
                
                const parseWorkflowNodes = (workflow) => {
                    const nodes = [];
                    
                    const inputNodeTypes = {
                        "LoadImage": "image",
                        "LoadVideo": "video",
                        "LoadAudio": "audio",
                        "CR Prompt Text": "text",
                        "easy showAnything": "text",
                        "Text": "text"
                    };
                    
                    const outputNodeTypes = {
                        "SaveImage": "image",
                        "PreviewImage": "image",
                        "VHS_VideoCombine": "video",
                        "easy showAnything": "text",
                        "SaveAudio": "audio"
                    };
                    
                    outputTypes = {image: false, text: false, audio: false, video: false};
                    
                    for (const [nodeId, nodeData] of Object.entries(workflow)) {
                        if (nodeData.class_type) {
                            const inputType = inputNodeTypes[nodeData.class_type];
                            const outputType = outputNodeTypes[nodeData.class_type];
                            
                            if (inputType) {
                                nodes.push({
                                    id: nodeId,
                                    type: nodeData.class_type,
                                    category: inputType
                                });
                            }
                            
                            if (outputType) {
                                outputTypes[outputType] = true;
                            }
                        }
                    }
                    
                    nodes.sort((a, b) => parseInt(a.id) - parseInt(b.id));
                    return nodes;
                };
                
                const rebuildPorts = () => {
                    const enabledList = workflowNodes.filter(n => enabledNodes[n.id]);
                    if (enabledList.length === 0) {
                        return false;
                    }
                    
                    while (node.inputs.length > 0) {
                        node.removeInput(0);
                    }
                    
                    const sorted = enabledList.sort((a, b) => parseInt(a.id) - parseInt(b.id));
                    
                    const inputCounts = {image: 0, text: 0, audio: 0, video: 0};
                    sorted.forEach(n => {
                        inputCounts[n.category]++;
                    });
                    
                    for (const [type, count] of Object.entries(inputCounts)) {
                        if (count === 0) continue;
                        
                        for (let i = 1; i <= count; i++) {
                            const inputName = `${type}_${i}`;
                            let inputType;
                            
                            if (type === "text") {
                                inputType = "STRING";
                            } else if (type === "audio") {
                                inputType = "AUDIO";
                            } else {
                                inputType = "IMAGE";
                            }
                            
                            node.addInput(inputName, inputType);
                            
                            let currentCount = 0;
                            for (const n of sorted) {
                                if (n.category === type) {
                                    currentCount++;
                                    if (currentCount === i) {
                                        const input = node.inputs[node.inputs.length - 1];
                                        if (input) {
                                            input.label = `${inputName} → 节点${n.id}(${n.type})`;
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    const selectedMap = {};
                    enabledList.forEach(n => {
                        selectedMap[n.id] = n.category;
                    });
                    selectedNodesWidget.value = JSON.stringify(selectedMap);
                    
                    node.setSize(node.computeSize());
                    return true;
                };
                
                const createIpModal = () => {
                    const overlay = document.createElement("div");
                    overlay.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.8);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 10000;
                    `;
                    
                    const modal = document.createElement("div");
                    modal.style.cssText = `
                        background: #2a2a2a;
                        border-radius: 8px;
                        width: 500px;
                        display: flex;
                        flex-direction: column;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                    `;
                    
                    const header = document.createElement("div");
                    header.style.cssText = `
                        padding: 20px;
                        border-bottom: 1px solid #444;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    `;
                    
                    const title = document.createElement("h2");
                    title.textContent = "⚙️ 远程服务器设置";
                    title.style.cssText = `
                        margin: 0;
                        color: #fff;
                        font-size: 18px;
                    `;
                    
                    const closeBtn = document.createElement("button");
                    closeBtn.textContent = "×";
                    closeBtn.style.cssText = `
                        background: none;
                        border: none;
                        color: #fff;
                        font-size: 28px;
                        cursor: pointer;
                        padding: 0;
                        width: 30px;
                        height: 30px;
                        line-height: 28px;
                    `;
                    closeBtn.onclick = () => document.body.removeChild(overlay);
                    
                    header.appendChild(title);
                    header.appendChild(closeBtn);
                    
                    const content = document.createElement("div");
                    content.style.cssText = `
                        padding: 30px;
                    `;
                    
                    const ipLabel = document.createElement("div");
                    ipLabel.textContent = "🌐 IP地址";
                    ipLabel.style.cssText = `
                        color: #aaa;
                        margin-bottom: 10px;
                        font-size: 14px;
                    `;
                    
                    const ipInput = document.createElement("input");
                    ipInput.type = "text";
                    ipInput.value = ipWidget.value;
                    ipInput.placeholder = "例如: 192.168.1.100";
                    ipInput.style.cssText = `
                        width: 100%;
                        padding: 12px;
                        background: #1a1a1a;
                        color: white;
                        border: 1px solid #555;
                        border-radius: 5px;
                        font-size: 14px;
                        margin-bottom: 20px;
                        box-sizing: border-box;
                    `;
                    
                    const portLabel = document.createElement("div");
                    portLabel.textContent = "🔌 端口";
                    portLabel.style.cssText = `
                        color: #aaa;
                        margin-bottom: 10px;
                        font-size: 14px;
                    `;
                    
                    const portInput = document.createElement("input");
                    portInput.type = "number";
                    portInput.value = portWidget.value;
                    portInput.placeholder = "例如: 8188";
                    portInput.min = "1";
                    portInput.max = "65535";
                    portInput.style.cssText = `
                        width: 100%;
                        padding: 12px;
                        background: #1a1a1a;
                        color: white;
                        border: 1px solid #555;
                        border-radius: 5px;
                        font-size: 14px;
                        box-sizing: border-box;
                    `;
                    
                    content.appendChild(ipLabel);
                    content.appendChild(ipInput);
                    content.appendChild(portLabel);
                    content.appendChild(portInput);
                    
                    const footer = document.createElement("div");
                    footer.style.cssText = `
                        padding: 20px;
                        border-top: 1px solid #444;
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                    `;
                    
                    const cancelBtn = document.createElement("button");
                    cancelBtn.textContent = "取消";
                    cancelBtn.style.cssText = `
                        padding: 10px 20px;
                        background: #666;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    `;
                    cancelBtn.onclick = () => document.body.removeChild(overlay);
                    
                    const saveBtn = document.createElement("button");
                    saveBtn.textContent = "💾 保存";
                    saveBtn.style.cssText = `
                        padding: 10px 20px;
                        background: #0088ff;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                    `;
                    saveBtn.onclick = () => {
                        const newIp = ipInput.value.trim();
                        const newPort = parseInt(portInput.value);
                        
                        if (!newIp) {
                            alert("请输入IP地址！");
                            return;
                        }
                        
                        if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
                            alert("端口必须在1-65535之间！");
                            return;
                        }
                        
                        ipWidget.value = newIp;
                        portWidget.value = newPort;
                        updateIpDisplay();
                        
                        document.body.removeChild(overlay);
                    };
                    
                    footer.appendChild(cancelBtn);
                    footer.appendChild(saveBtn);
                    
                    modal.appendChild(header);
                    modal.appendChild(content);
                    modal.appendChild(footer);
                    overlay.appendChild(modal);
                    
                    document.body.appendChild(overlay);
                    
                    ipInput.focus();
                };
                
                const createWorkflowModal = () => {
                    const overlay = document.createElement("div");
                    overlay.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.8);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 10000;
                    `;
                    
                    const modal = document.createElement("div");
                    modal.style.cssText = `
                        background: #2a2a2a;
                        border-radius: 8px;
                        width: 600px;
                        max-height: 80vh;
                        display: flex;
                        flex-direction: column;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                    `;
                    
                    const header = document.createElement("div");
                    header.style.cssText = `
                        padding: 20px;
                        border-bottom: 1px solid #444;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    `;
                    
                    const title = document.createElement("h2");
                    title.textContent = "🔧 工作流解析器";
                    title.style.cssText = `
                        margin: 0;
                        color: #fff;
                        font-size: 18px;
                    `;
                    
                    const closeBtn = document.createElement("button");
                    closeBtn.textContent = "×";
                    closeBtn.style.cssText = `
                        background: none;
                        border: none;
                        color: #fff;
                        font-size: 28px;
                        cursor: pointer;
                        padding: 0;
                        width: 30px;
                        height: 30px;
                        line-height: 28px;
                    `;
                    closeBtn.onclick = () => document.body.removeChild(overlay);
                    
                    header.appendChild(title);
                    header.appendChild(closeBtn);
                    
                    const content = document.createElement("div");
                    content.style.cssText = `
                        padding: 20px;
                        overflow-y: auto;
                        flex: 1;
                    `;
                    
                    const uploadSection = document.createElement("div");
                    uploadSection.style.cssText = `margin-bottom: 20px;`;
                    
                    const uploadLabel = document.createElement("div");
                    uploadLabel.textContent = "📁 上传工作流文件 (API格式 JSON)";
                    uploadLabel.style.cssText = `
                        color: #aaa;
                        margin-bottom: 10px;
                        font-size: 14px;
                    `;
                    
                    const fileInput = document.createElement("input");
                    fileInput.type = "file";
                    fileInput.accept = ".json";
                    fileInput.style.cssText = `
                        width: 100%;
                        padding: 10px;
                        background: #1a1a1a;
                        color: white;
                        border: 2px dashed #555;
                        border-radius: 5px;
                        cursor: pointer;
                    `;
                    
                    uploadSection.appendChild(uploadLabel);
                    uploadSection.appendChild(fileInput);
                    content.appendChild(uploadSection);
                    
                    const nodesSection = document.createElement("div");
                    nodesSection.style.cssText = `
                        margin-top: 20px;
                        border: 1px solid #444;
                        border-radius: 5px;
                        padding: 15px;
                        background: #1a1a1a;
                    `;
                    
                    const nodesTitle = document.createElement("div");
                    nodesTitle.textContent = "📋 可用节点列表";
                    nodesTitle.style.cssText = `
                        color: #fff;
                        margin-bottom: 15px;
                        font-weight: bold;
                    `;
                    nodesSection.appendChild(nodesTitle);
                    
                    const nodesList = document.createElement("div");
                    nodesList.style.cssText = `
                        max-height: 300px;
                        overflow-y: auto;
                    `;
                    
                    const renderNodesList = () => {
                        nodesList.innerHTML = "";
                        
                        if (workflowNodes.length === 0) {
                            const emptyMsg = document.createElement("div");
                            emptyMsg.textContent = "请先上传工作流文件...";
                            emptyMsg.style.cssText = `
                                color: #666;
                                text-align: center;
                                padding: 40px;
                                font-style: italic;
                            `;
                            nodesList.appendChild(emptyMsg);
                            return;
                        }
                        
                        const categoryIcons = {
                            image: "🖼️",
                            text: "📝",
                            audio: "🔊",
                            video: "🎬"
                        };
                        
                        workflowNodes.forEach(nodeInfo => {
                            const nodeItem = document.createElement("div");
                            nodeItem.style.cssText = `
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                padding: 12px;
                                background: #2a2a2a;
                                border-radius: 5px;
                                margin-bottom: 8px;
                                border: 1px solid #444;
                            `;
                            
                            const nodeLabel = document.createElement("span");
                            nodeLabel.style.cssText = `
                                color: white;
                                font-size: 14px;
                                flex: 1;
                            `;
                            const icon = categoryIcons[nodeInfo.category] || "❓";
                            nodeLabel.textContent = `${icon} 节点 ${nodeInfo.id} - ${nodeInfo.type}`;
                            
                            const toggleContainer = document.createElement("div");
                            toggleContainer.style.cssText = `position: relative; width: 50px; height: 24px;`;
                            
                            const checkbox = document.createElement("input");
                            checkbox.type = "checkbox";
                            checkbox.checked = enabledNodes[nodeInfo.id] || false;
                            checkbox.style.cssText = `
                                position: absolute;
                                opacity: 0;
                                width: 100%;
                                height: 100%;
                                cursor: pointer;
                                z-index: 2;
                            `;
                            
                            const slider = document.createElement("div");
                            slider.style.cssText = `
                                position: absolute;
                                width: 50px;
                                height: 24px;
                                background: ${checkbox.checked ? '#00aa00' : '#666'};
                                border-radius: 12px;
                                transition: background 0.3s;
                            `;
                            
                            const sliderButton = document.createElement("div");
                            sliderButton.style.cssText = `
                                position: absolute;
                                width: 18px;
                                height: 18px;
                                background: white;
                                border-radius: 50%;
                                top: 3px;
                                left: ${checkbox.checked ? '27px' : '3px'};
                                transition: left 0.3s;
                            `;
                            slider.appendChild(sliderButton);
                            
                            checkbox.onchange = () => {
                                enabledNodes[nodeInfo.id] = checkbox.checked;
                                slider.style.backgroundColor = checkbox.checked ? '#00aa00' : '#666';
                                sliderButton.style.left = checkbox.checked ? '27px' : '3px';
                            };
                            
                            toggleContainer.appendChild(checkbox);
                            toggleContainer.appendChild(slider);
                            
                            nodeItem.appendChild(nodeLabel);
                            nodeItem.appendChild(toggleContainer);
                            nodesList.appendChild(nodeItem);
                        });
                        
                        const outInfo = [];
                        if (outputTypes.image) outInfo.push("图像");
                        if (outputTypes.text) outInfo.push("文本");
                        if (outputTypes.audio) outInfo.push("音频");
                        if (outputTypes.video) outInfo.push("视频");
                        
                        const resultMsg = document.createElement("div");
                        resultMsg.style.cssText = `
                            margin-top: 15px;
                            padding: 10px;
                            background: #1a3a1a;
                            border-radius: 5px;
                            color: #0f0;
                            font-size: 12px;
                            text-align: center;
                        `;
                        resultMsg.textContent = `✅ 找到 ${workflowNodes.length} 个输入节点 | 检测到输出: ${outInfo.join(", ") || "无"}`;
                        nodesSection.appendChild(resultMsg);
                    };
                    
                    renderNodesList();
                    
                    nodesSection.appendChild(nodesList);
                    content.appendChild(nodesSection);
                    
                    fileInput.onchange = async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        
                        try {
                            const text = await file.text();
                            workflowData = JSON.parse(text);
                            workflowFileWidget.value = text;
                            
                            const nodes = parseWorkflowNodes(workflowData);
                            workflowNodes = nodes;
                            
                            enabledNodes = {};
                            
                            renderNodesList();
                            
                        } catch (err) {
                            alert("解析失败: " + err.message);
                        }
                    };
                    
                    const footer = document.createElement("div");
                    footer.style.cssText = `
                        padding: 20px;
                        border-top: 1px solid #444;
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                    `;
                    
                    const cancelBtn = document.createElement("button");
                    cancelBtn.textContent = "取消";
                    cancelBtn.style.cssText = `
                        padding: 10px 20px;
                        background: #666;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    `;
                    cancelBtn.onclick = () => document.body.removeChild(overlay);
                    
                    const saveBtn = document.createElement("button");
                    saveBtn.textContent = "💾 保存并更新端口";
                    saveBtn.style.cssText = `
                        padding: 10px 20px;
                        background: #0088ff;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                    `;
                    saveBtn.onclick = () => {
                        const enabledList = workflowNodes.filter(n => enabledNodes[n.id]);
                        if (enabledList.length === 0) {
                            alert("请至少启用一个节点！");
                            return;
                        }
                        
                        saveState();
                        rebuildPorts();
                        app.graph.setDirtyCanvas(true, true);
                        
                        document.body.removeChild(overlay);
                        
                        const inputCounts = {image: 0, text: 0, audio: 0, video: 0};
                        enabledList.forEach(n => inputCounts[n.category]++);
                        
                        const outInfo = [];
                        if (outputTypes.image) outInfo.push("图像");
                        if (outputTypes.text) outInfo.push("文本");
                        if (outputTypes.audio) outInfo.push("音频");
                        if (outputTypes.video) outInfo.push("视频");
                        
                        alert(`✅ 保存成功！\n\n输入端口: 图像×${inputCounts.image} 文本×${inputCounts.text} 音频×${inputCounts.audio} 视频×${inputCounts.video}\n输出端口: ${outInfo.join("、") || "无"}\n\n节点已更新，可以开始使用了！`);
                    };
                    
                    footer.appendChild(cancelBtn);
                    footer.appendChild(saveBtn);
                    
                    modal.appendChild(header);
                    modal.appendChild(content);
                    modal.appendChild(footer);
                    overlay.appendChild(modal);
                    
                    document.body.appendChild(overlay);
                };
                
                const mainContainer = document.createElement("div");
                mainContainer.style.cssText = `
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                `;
                
                const ipContainer = document.createElement("div");
                ipContainer.style.cssText = `
                    padding: 8px;
                    background: #1a1a1a;
                    border-radius: 3px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;
                
                const ipDisplay = document.createElement("div");
                ipDisplay.style.cssText = `
                    color: #00ff00;
                    font-size: 12px;
                    font-family: monospace;
                    font-weight: bold;
                `;
                
                let ipHidden = true;
                
                const updateIpDisplay = () => {
                    if (ipWidget && portWidget) {
                        if (ipHidden) {
                            ipDisplay.textContent = `🌐 ***.***.***:****`;
                        } else {
                            ipDisplay.textContent = `🌐 ${ipWidget.value}:${portWidget.value}`;
                        }
                    }
                };
                
                updateIpDisplay();
                
                const btnContainer = document.createElement("div");
                btnContainer.style.cssText = `display: flex; gap: 5px;`;
                
                const ipEditBtn = document.createElement("button");
                ipEditBtn.textContent = "⚙️";
                ipEditBtn.style.cssText = `
                    padding: 3px 8px;
                    background: #444;
                    color: white;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 12px;
                `;
                ipEditBtn.onclick = createIpModal;
                
                const ipToggleBtn = document.createElement("button");
                ipToggleBtn.textContent = ipHidden ? "👁️" : "🔒";
                ipToggleBtn.style.cssText = `
                    padding: 3px 8px;
                    background: #444;
                    color: white;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 12px;
                `;
                ipToggleBtn.onclick = () => {
                    ipHidden = !ipHidden;
                    ipToggleBtn.textContent = ipHidden ? "👁️" : "🔒";
                    updateIpDisplay();
                };
                
                btnContainer.appendChild(ipEditBtn);
                btnContainer.appendChild(ipToggleBtn);
                
                ipContainer.appendChild(ipDisplay);
                ipContainer.appendChild(btnContainer);
                mainContainer.appendChild(ipContainer);
                
                const parseBtn = document.createElement("button");
                parseBtn.textContent = "🔧 解析工作流";
                parseBtn.style.cssText = `
                    padding: 12px;
                    background: #0088ff;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 14px;
                `;
                parseBtn.onclick = createWorkflowModal;
                
                mainContainer.appendChild(parseBtn);
                
                const widget = node.addDOMWidget("workflow_control", "control", mainContainer);
                widget.serializeValue = () => "";
                
                node.setSize([400, 140]);
                if (!node.properties) node.properties = {};
                node.properties.minWidth = 400;
                node.properties.minHeight = 140;
                
                const hiddenWidgets = [workflowFileWidget, selectedNodesWidget, savedStateWidget, ipWidget, portWidget];
                hiddenWidgets.forEach(w => {
                    if (w) {
                        Object.defineProperty(w, 'computeSize', {
                            value: function() { return [0, -4]; },
                            writable: false
                        });
                        w.type = "converted-widget";
                        w.hidden = true;
                    }
                });
                
                const originalOnConfigure = node.onConfigure;
                node.onConfigure = function(info) {
                    if (originalOnConfigure) {
                        originalOnConfigure.call(this, info);
                    }
                    
                    const restored = restoreState();
                    if (restored) {
                        rebuildPorts();
                    }
                };
                
                const originalSerialize = node.serialize;
                node.serialize = function() {
                    saveState();
                    return originalSerialize ? originalSerialize.call(this) : {};
                };
                
                return result;
            };  
        }
    }
});
