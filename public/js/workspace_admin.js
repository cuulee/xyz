let editor = new JSONEditor(document.getElementById("jsoneditor"), { mode: mode });

let json = _xyz;

editor.set(json);

json = editor.get();

let editormenu = document.querySelector('.jsoneditor-menu');
let search = document.querySelector('.jsoneditor-search');

//add save button
let btnSave = document.createElement('button');
btnSave.style.background = 'none';
btnSave.innerHTML = '<i class="material-icons" title="Upload settings to data store.">cloud_upload</i>';
editormenu.insertBefore(btnSave, search);

btnSave.addEventListener('click', function () {
    let xhr = new XMLHttpRequest();
    xhr.open('POST', 'workspace/save');
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = function () {
        if (this.status === 406) alert('Cannot save file based settings.');
        if (this.status === 200) alert('Settings saved.');
    }

    xhr.send(JSON.stringify({
        settings: editor.get()
    }));
});

if (mode === 'tree') {
    let btnFile = document.createElement('button');
    btnFile.style.background = 'none';
    btnFile.innerHTML = '<i class="material-icons" title="Upload settings file.">description</i>';
    editormenu.insertBefore(btnFile, search);
    
    let fileSelector = document.createElement('input');
    fileSelector.style.display = 'none';
    fileSelector.setAttribute('type', 'file');
    fileSelector.setAttribute('accept', '.json');
    btnFile.appendChild(fileSelector);
    
    fileSelector.addEventListener('change', function () {
        let reader = new FileReader();
        reader.onload = function () {
            editor.set(JSON.parse(this.result));
        };
        reader.readAsText(this.files[0])
    });
    
    btnFile.addEventListener('click', function () {
        fileSelector.click();
        //return false;
    });
    
    editormenu.insertBefore(btnFile, search);
}

if (mode === 'tree') {
    let btnCode = document.createElement('button');
    btnCode.style.background = 'none';
    btnCode.innerHTML = '<i class="material-icons" title="Upload settings file.">code</i>';
    editormenu.insertBefore(btnCode, search);

    btnCode.addEventListener('click', function () {
        window.location.replace('workspacejson');
    });
}

if (mode === 'code') {
    let btnTree = document.createElement('button');
    btnTree.style.background = 'none';
    btnTree.innerHTML = '<i class="material-icons" title="Upload settings file.">list</i>';
    editormenu.insertBefore(btnTree, search);

    btnTree.addEventListener('click', function () {
        window.location.replace('workspace');
    });
}