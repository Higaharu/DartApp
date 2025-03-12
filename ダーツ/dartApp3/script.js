// script.js

// showAlert関数をグローバルスコープに定義
function showAlert(element, message, type) {
    element.innerHTML = message;
    element.className = `alert ${type}`;
    element.style.display = 'block';
}

// TensorFlow.js のバックエンドを WebGL に設定
tf.setBackend('webgl');

// グローバル変数
let calibrationData = null;
let trainingFiles = [];
let processedTrainingData = [];
let testData = null;
let processedTestData = null;
let muscleMeans = {};
let muscleStdDevs = {}; // 標準偏差を格納するオブジェクト
let neuralNetwork = null;
let predictions = [];
let isPlaying = false;
let currentFrame = 0;
let animationFrameId = null;
let animationSpeed = 50;
let processedFileCount = 0;
let totalFileCount = 0;

// 期待される列数
const calibrationExpectedColumns = 16; // Timestamp, Power, Ch.0, ..., Ch.13
const muscleChannels = Array.from({ length: 14 }, (_, i) => `Ch.${i}`);
const angleColumns = ['elbow_angle', 'wrist_angle', 'shoulder_angle'];

// UI要素
const calibrationFileInput = document.getElementById('calibrationFile');
const processCalibrationButton = document.getElementById('processCalibration');
const calibrationResultDiv = document.getElementById('calibrationResult');

const trainingFileInput = document.getElementById('trainingFile');
const trainingFileListDiv = document.getElementById('trainingFileList');
const processingStatusDiv = document.getElementById('processingStatus');
const processTrainingButton = document.getElementById('processTraining');
const trainingResultDiv = document.getElementById('trainingResult');

const buildModelButton = document.getElementById('buildModel');
const modelResultDiv = document.getElementById('modelResult');
const modelInfoDiv = document.getElementById('modelInfo');
const modelProgressContainer = document.getElementById('modelProgressContainer');
const modelProgressBar = document.getElementById('modelProgressBar');
const loadingIndicator = document.getElementById('loadingIndicator');
const epochsInput = document.getElementById('epochs');
const batchSizeInput = document.getElementById('batchSize');
const hiddenUnits1Input = document.getElementById('hiddenUnits1');
const hiddenUnits2Input = document.getElementById('hiddenUnits2');
const activationSelect = document.getElementById('activation');

const testFileInput = document.getElementById('testFile');
const processTestButton = document.getElementById('processTest');
const testResultDiv = document.getElementById('testResult');

const playAnimationButton = document.getElementById('playAnimation');
const pauseAnimationButton = document.getElementById('pauseAnimation');
const resetAnimationButton = document.getElementById('resetAnimation');
const angleInfoDiv = document.getElementById('angleInfo');

// イベントリスナー
processCalibrationButton.addEventListener('click', processCalibrationData);
processTrainingButton.addEventListener('click', processTrainingData);
buildModelButton.addEventListener('click', buildNeuralNetworkModel);
processTestButton.addEventListener('click', processTestData);
playAnimationButton.addEventListener('click', playAnimation);
pauseAnimationButton.addEventListener('click', pauseAnimation);
resetAnimationButton.addEventListener('click', resetAnimation);

// ファイルが選択されたときの処理 (trainingFile)
trainingFileInput.addEventListener('change', () => {
    trainingFiles = Array.from(trainingFileInput.files);
    totalFileCount = trainingFiles.length;
    processedFileCount = 0; // カウンターをリセット
    processingStatusDiv.textContent = ''; // ステータスをクリア

    if (trainingFiles.length > 0) {
        trainingFileListDiv.style.display = 'block';
        trainingFileListDiv.innerHTML = ''; // リストをクリア

        trainingFiles.forEach((file, index) => {
            const listItem = document.createElement('div');
            listItem.classList.add('file-list-item');
            listItem.innerHTML = `
                <span>${file.name}</span>
                <button class="remove-file" data-index="${index}">削除</button>
            `;
            trainingFileListDiv.appendChild(listItem);
        });

        // 削除ボタンのイベントリスナー
        trainingFileListDiv.querySelectorAll('.remove-file').forEach(button => {
            button.addEventListener('click', (event) => {
                const indexToRemove = parseInt(event.target.dataset.index);
                trainingFiles.splice(indexToRemove, 1); // 配列から削除
                totalFileCount = trainingFiles.length;
                // リストを再描画
                trainingFileListDiv.innerHTML = '';
                trainingFiles.forEach((file, index) => {
                    const listItem = document.createElement('div');
                    listItem.classList.add('file-list-item');
                    listItem.innerHTML = `
                        <span>${file.name}</span>
                        <button class="remove-file" data-index="${index}">削除</button>
                    `;
                    trainingFileListDiv.appendChild(listItem);
                });
                if (trainingFiles.length === 0) {
                    trainingFileListDiv.style.display = 'none';
                    processTrainingButton.disabled = true;
                }
            });
        });
        processTrainingButton.disabled = false;
    } else {
        trainingFileListDiv.style.display = 'none';
        processTrainingButton.disabled = true;
    }
});

// キャリブレーションデータの処理
function processCalibrationData() {
    const file = calibrationFileInput.files[0];
    if (!file) {
        showAlert(calibrationResultDiv, 'ファイルを選択してください。', 'alert-warning');
        return;
    }

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            if (results.errors.length > 0) {
                showAlert(calibrationResultDiv, 'CSVファイルの解析中にエラーが発生しました。', 'alert-danger');
                console.error(results.errors);
                return;
            }

            const fileCalibrationData = results.data;

            const requiredColumns = ["Timestamp", "Power", ...muscleChannels];
            const missingColumns = requiredColumns.filter(col => !(col in fileCalibrationData[0]));

            if (missingColumns.length > 0) {
                showAlert(calibrationResultDiv, `必要なカラムがありません: ${missingColumns.join(', ')}`, 'alert-warning');
                return;
            }

            const validData = fileCalibrationData.filter((row, rowIndex) => {
                const isValidRow = requiredColumns.every(col => {
                    if (row[col] === null || row[col] === undefined || (col !== "Timestamp" && isNaN(row[col]))) {
                        console.error(`Row ${rowIndex + 2}: Column '${col}' is missing or not a number.`);
                        return false;
                    }
                    return true;
                });

                if (!isValidRow) {
                    showAlert(calibrationResultDiv, `CSVファイルの${rowIndex + 2}行目に不正なデータがあります。`, 'alert-warning');
                }
                return isValidRow;
            });

            calibrationData = validData;

            if (calibrationData.length === 0) {
                showAlert(calibrationResultDiv, '有効なデータがありません。', 'alert-warning');
                return;
            }

            // 平均値の計算
            muscleMeans = {};
            muscleChannels.forEach(ch => {
                const values = calibrationData.map(row => row[ch]);
                muscleMeans[ch] = values.reduce((sum, value) => sum + value, 0) / values.length;
            });

            // 標準偏差の計算 (ここが追加)
            muscleStdDevs = {};
            muscleChannels.forEach(ch => {
                const values = calibrationData.map(row => row[ch]);
                const mean = muscleMeans[ch];
                muscleStdDevs[ch] = Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
            });

            // 結果の表示
            let resultHTML = '<h3>キャリブレーション結果</h3>';
            resultHTML += '<p>各チャネルの平均値（安静時）:</p>';
            resultHTML += '<table><tr><th>チャネル</th><th>平均値</th><th>標準偏差</th></tr>'; // テーブルヘッダー変更
            muscleChannels.forEach(ch => {
                resultHTML += `<tr><td>${ch}</td><td>${muscleMeans[ch].toFixed(2)}</td><td>${muscleStdDevs[ch].toFixed(2)}</td></tr>`; // 標準偏差も表示
            });
            resultHTML += '</table>';

            showAlert(calibrationResultDiv, resultHTML, 'alert-success');
        }
    });
}

// トレーニングデータの処理
function processTrainingData() {
    if (!muscleMeans || Object.keys(muscleMeans).length === 0) {
        showAlert(trainingResultDiv, 'キャリブレーションデータを先に処理してください。', 'alert-warning');
        return;
    }

    processedTrainingData = [];
    processedFileCount = 0;
    processingStatusDiv.textContent = `0 / ${totalFileCount} ファイル処理済み`;

    trainingFiles.forEach(file => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function (results) {
                if (results.errors.length > 0) {
                    showAlert(trainingResultDiv, `CSVファイルの解析中にエラーが発生しました。: ${results.errors[0].message}`, 'alert-danger');
                    console.error('Parsing errors:', results.errors);
                    return;
                }

                let fileTrainingData = results.data;

                // 必要なカラムが存在するか確認
                const requiredColumns = ["Timestamp", "Power", ...muscleChannels, ...angleColumns];
                const missingColumns = requiredColumns.filter(col => !(col in fileTrainingData[0]));

                if (missingColumns.length > 0) {
                    showAlert(trainingResultDiv, `必要なカラムがありません: ${missingColumns.join(', ')}`, 'alert-warning');
                    return;
                }
                const validData = fileTrainingData.filter((row, rowIndex) => {
                    const isValidRow = requiredColumns.every(col => {
                        if (row[col] === null || row[col] === undefined) {
                            console.error(`Row ${rowIndex + 2}: Column '${col}' is missing.`);
                            return false;
                        }
                        if (muscleChannels.includes(col) || angleColumns.includes(col)) { //timestamp以外で、
                            if (isNaN(row[col])) {
                                console.error(`Row ${rowIndex + 2}: Column '${col}' is not a number.`);
                                return false;
                            }
                        }

                        return true;
                    });

                    if (!isValidRow) {
                        showAlert(trainingResultDiv, `CSVファイルの${rowIndex + 2}行目に不正なデータがあります。`, 'alert-warning');
                    }
                    return isValidRow;
                });

                // 前処理 (標準化)
                const fileProcessedTrainingData = validData.map(row => {
                    const processedRow = { ...row };
                    muscleChannels.forEach(ch => {
                        // (値 - 平均値) / 標準偏差  で標準化
                        processedRow[ch] = (row[ch] - muscleMeans[ch]) / muscleStdDevs[ch];
                    });
                    return processedRow;
                });

                processedTrainingData = processedTrainingData.concat(fileProcessedTrainingData);

                // 処理済みファイル数の更新と表示
                processedFileCount++;
                processingStatusDiv.textContent = `${processedFileCount} / ${totalFileCount} ファイル処理済み`;

                if (processedFileCount === totalFileCount) {
                    if (processedTrainingData.length > 0) {
                        const resultHTML = `
                            <h3>トレーニングデータ前処理結果</h3>
                            <p>処理されたデータポイント数: ${processedTrainingData.length}</p>
                            <p>前処理方法: 各チャネルから安静時の平均値を引いて標準化しました</p>
                        `;
                        showAlert(trainingResultDiv, resultHTML, 'alert-success');
                        buildModelButton.disabled = false;
                    }
                }
            },
            error: function (error) {
                console.error("Error:", error);
                showAlert(trainingResultDiv, `CSVファイルの読み込み中にエラーが発生しました: ${error.message}`, 'alert-danger');
            }
        });
    });
}

// モデル構築
async function buildNeuralNetworkModel() {
    if (!processedTrainingData || processedTrainingData.length === 0) {
        showAlert(modelResultDiv, 'トレーニングデータを先に処理してください。', 'alert-warning');
        return;
    }

    showAlert(modelResultDiv, 'モデルを構築中...', 'alert-info');
    loadingIndicator.style.display = 'block';
    modelProgressContainer.style.display = 'block';
    buildModelButton.disabled = true;

    const inputData = processedTrainingData.map(row => {
        return muscleChannels.map(ch => parseFloat(row[ch]));
    });
    const outputData = processedTrainingData.map(row => {
        return angleColumns.map(col => parseFloat(row[col]));
    });

    // デバッグ用にデータを出力 (確認が終わったら削除してOK)
    console.log("Input data:", inputData);
    console.log("Output data:", outputData);

    const options = {
        task: 'regression',
        debug: true
    };

    try {
        neuralNetwork = ml5.neuralNetwork(options);

        neuralNetwork.inputLayerSize = muscleChannels.length;
        neuralNetwork.outputLayerSize = angleColumns.length;

        console.log(`Adding ${inputData.length} training examples...`);
        for (let i = 0; i < inputData.length; i++) {
            neuralNetwork.addData(inputData[i], outputData[i]);
        }

        // neuralNetwork.normalizeData();  // 手動で正規化/標準化するので削除

        const trainingOptions = {
            epochs: parseInt(epochsInput.value),
            batchSize: parseInt(batchSizeInput.value)
        };

        console.log("Starting model training with options:", trainingOptions);

        function whileTraining(epoch, loss) {
            if (loss !== undefined) { // loss が undefined でないことをチェック
                console.log(`Epoch: ${epoch}, Loss: ${loss}`);
                const progress = Math.round((epoch / trainingOptions.epochs) * 100);
                modelProgressBar.style.width = `${progress}%`;
                modelProgressBar.textContent = `${progress}%`;
                modelInfoDiv.innerHTML = `エポック: ${epoch}/${trainingOptions.epochs}, 損失: ${loss.toFixed(4)}`; // loss を直接使う
            } else {
                console.warn("Loss is undefined or loss.loss is undefined", loss);
                modelProgressBar.style.width = `0%`; // NaN%と表示されていたのを修正
                modelProgressBar.textContent = `0%`; // NaN%と表示されていたのを修正
                modelInfoDiv.innerHTML = `エポック: ${epoch}/${trainingOptions.epochs}, 損失: N/A`;
            }
        }

        function finishedTraining() {
            console.log("Model training completed successfully!");
            loadingIndicator.style.display = 'none';
            showAlert(modelResultDiv, 'モデルのトレーニングが完了しました！', 'alert-success');
            modelInfoDiv.innerHTML += '<br>モデルの構築が完了しました。テストデータを処理できます。';
            processTestButton.disabled = false;
        }

        await neuralNetwork.train(trainingOptions, whileTraining);
        finishedTraining();


    } catch (error) {
        console.error("Error during model building:", error);
        showAlert(modelResultDiv, `モデル構築中にエラーが発生しました: ${error.message}`, 'alert-danger');
        loadingIndicator.style.display = 'none';
        modelProgressContainer.style.display = 'none';
        buildModelButton.disabled = false; // エラーが起きたらボタンを再度有効化
    }
}

// テストデータの処理と予測
function processTestData() {
    const file = testFileInput.files[0];
    if (!file) {
        showAlert(testResultDiv, 'ファイルを選択してください。', 'alert-warning');
        return;
    }

    if (!neuralNetwork) {
        showAlert(testResultDiv, 'モデルを先に構築してください。', 'alert-warning');
        return;
    }

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            if (results.errors.length > 0) {
                showAlert(testResultDiv, `CSVファイルの解析中にエラーが発生しました。: ${results.errors[0].message}`, 'alert-danger');
                console.error('Parsing errors:', results.errors);
                return;
            }

            let fileTestData = results.data;

            // 必要なカラムが存在するか確認
            const requiredColumns = ["Timestamp", "Power", ...muscleChannels];
            const missingColumns = requiredColumns.filter(col => !(col in fileTestData[0]));
            if (missingColumns.length > 0) {
                showAlert(testResultDiv, `必要なカラムがありません: ${missingColumns.join(', ')}`, 'alert-warning');
                return;
            }

            // 詳細なデータチェックと数値変換(muscleDataのみで良い)
            const validData = fileTestData.filter((row, rowIndex) => {
                const isValidRow = requiredColumns.every(col => {
                    if (row[col] === null || row[col] === undefined) {
                        console.error(`Row ${rowIndex + 2}: Column '${col}' is missing.`);
                        return false; // 欠損値
                    }
                    if (muscleChannels.includes(col)) { //muscleDataのみ数値チェック
                        const numValue = parseFloat(row[col]);
                        if (isNaN(numValue)) {
                            console.error(`Row ${rowIndex + 2}: Column '${col}' is not a number.`);
                            return false; // 数値ではない
                        }
                        row[col] = numValue; //数値で上書き

                    }
                    return true;
                });
                if (!isValidRow) {
                    showAlert(testResultDiv, `CSVファイルの${rowIndex + 2}行目に不正なデータがあります。`, 'alert-warning');
                }
                return isValidRow;
            });

            testData = validData;

            if (testData.length === 0) {
                showAlert(testResultDiv, '有効なデータがありません。', 'alert-warning');
                return;
            }


            // 前処理 (キャリブレーションデータの平均値と標準偏差で標準化)
            processedTestData = testData.map(row => {
                const processedRow = { ...row };
                muscleChannels.forEach(ch => {
                    // (値 - 平均値) / 標準偏差  で標準化
                    processedRow[ch] = (row[ch] - muscleMeans[ch]) / muscleStdDevs[ch];
                });
                return processedRow;
            });

            console.log("processedTestData:", processedTestData); // 確認用

            // モデルを使用して予測
            showAlert(testResultDiv, '予測を実行中...', 'alert-info');
            predictions = []; // 予測結果をリセット
            let predictionPromises = [];

            // 各フレームごとに予測を行う
            processedTestData.forEach((row, index) => {
                const input = muscleChannels.map(ch => row[ch]); // 数値の配列

                // 予測処理をPromiseでラップ
                const predictionPromise = new Promise((resolve, reject) => {
                    neuralNetwork.predict(input, (error, results) => {
                            if (error) {
                            console.error('予測エラー:', error, index);
                            // エラーの詳細をオブジェクトでrejectする
                            reject({
                                message: '予測エラー',
                                error: error, // errorオブジェクトそのもの
                                index: index, // エラーが発生したフレーム番号
                                input: input, // 入力データも追加
                                results: results // resultsも追加
                            });
                            return;
                        }

                        console.log("results:", results); // results の内容を確認

                        // results配列から、labelを見て正しいvalueを取り出す
                        const prediction = {};

                        // resultsが配列であることを確認し、その構造に合わせて処理
                        if (Array.isArray(results)) {
                            results.forEach(result => {
                                if (result && result.label !== undefined && result.value !== undefined) { //nullチェックとundefinedチェック
                                    if (result.label === "0") {
                                        prediction.elbow_angle = result.value;
                                    } else if (result.label === "1") {
                                        prediction.wrist_angle = result.value;
                                    } else if (result.label === "2") {
                                        prediction.shoulder_angle = result.value;
                                    }
                                } else { // resultsの構造が不正な場合
                                    console.error("Invalid result structure:", result);
                                    reject({message: "予測結果の構造が不正です", index: index, input: input, results: results});
                                    return;
                                }
                            });
                            } else {
                            console.error("Unexpected results format:", results);
                                reject({message: "予測結果が配列ではありません", index: index, input: input, results: results});
                                return;
                            }

                        predictions[index] = prediction; //predictionsに格納
                        resolve(); // 成功したらresolve
                    });
                });
                predictionPromises.push(predictionPromise);
            });

            // 全ての予測の完了を待つ
            Promise.all(predictionPromises)
            .then(() => {
                console.log("All predictions completed:", predictions.length);
                showAlert(testResultDiv, `${predictions.length}フレームの腕の角度予測が完了しました。`, 'alert-success');

                // アニメーションの初期化
                initializeAnimation();
                visualizeData();

                // コントロールボタンの有効化
                playAnimationButton.disabled = false;
                pauseAnimationButton.disabled = true; // 最初は一時停止ボタンを無効に
                resetAnimationButton.disabled = false;
            })
            .catch((errorObj) => { //rejectされた時のエラーオブジェクトを受け取る
                console.error("Prediction failed:", errorObj);
                let errorMessage = "予測中にエラーが発生しました";
                if (errorObj && errorObj.message) {
                    errorMessage += `: ${errorObj.message}`;
                }
                if (errorObj && errorObj.index !== undefined) {
                    errorMessage += ` (フレーム ${errorObj.index + 1})`;
                }
                if (errorObj && errorObj.input) {
                    errorMessage += `<br>入力データ: ${JSON.stringify(errorObj.input)}`;
                }
                if (errorObj && errorObj.results) { // results も表示
                    errorMessage += `<br>予測結果: ${JSON.stringify(errorObj.results)}`;
                }
                showAlert(testResultDiv, errorMessage, 'alert-danger');
            });
        },
        error: function (error) {
            console.error("Error:", error);
            showAlert(testResultDiv, `CSVファイルの読み込み中にエラーが発生しました: ${error.message}`, 'alert-danger');
        }
    });
}


function initializeAnimation() {
    // p5.jsのスケッチを作成
     new p5(function(p) {
        p.setup = function() {
            const canvasContainer = document.getElementById('animationContainer');
            const canvas = p.createCanvas(600, 400);
            canvas.parent(canvasContainer);
            p.angleMode(p.DEGREES);
            p.stroke(0);
            p.strokeWeight(4);
            p.noLoop();
        };

        p.draw = function() {
            p.background(240);

            if (predictions.length === 0 || currentFrame >= predictions.length) {
                return;
            }

            const prediction = predictions[currentFrame];

            // 角度情報を表示
            angleInfoDiv.innerHTML = `
                <p>フレーム: ${currentFrame + 1}/${predictions.length}</p>
                <p>肘の角度: ${prediction.elbow_angle.toFixed(2)}°</p>
                <p>手首の角度: ${prediction.wrist_angle.toFixed(2)}°</p>
                <p>肩の角度: ${prediction.shoulder_angle.toFixed(2)}°</p>
            `;

            // 腕のアニメーション
            const shoulderX = 150;
            const shoulderY = 200;
            const upperArmLength = 100;
            const forearmLength = 100;
            const handLength = 50;

            // 肩の角度から上腕の位置を計算
            const shoulderAngle = prediction.shoulder_angle;
            const elbowX = shoulderX + p.cos(shoulderAngle) * upperArmLength;
            const elbowY = shoulderY - p.sin(shoulderAngle) * upperArmLength;

            // 肘の角度から前腕の位置を計算
            const elbowAngle = prediction.elbow_angle;
            const wristX = elbowX + p.cos(shoulderAngle - elbowAngle) * forearmLength;
            const wristY = elbowY - p.sin(shoulderAngle - elbowAngle) * forearmLength;

            // 手首の角度から手の位置を計算
            const wristAngle = prediction.wrist_angle;
            const handX = wristX + p.cos(shoulderAngle - elbowAngle - wristAngle) * handLength;
            const handY = wristY - p.sin(shoulderAngle - elbowAngle - wristAngle) * handLength;

            // 腕を描画
            p.stroke(0);
            p.strokeWeight(8);
            p.line(shoulderX, shoulderY, elbowX, elbowY); // 上腕
            p.stroke(60, 120, 216);
            p.line(elbowX, elbowY, wristX, wristY); // 前腕
            p.stroke(216, 60, 60);
            p.line(wristX, wristY, handX, handY); // 手

            // 関節を描画
            p.fill(30);
            p.noStroke();
            p.ellipse(shoulderX, shoulderY, 15, 15); // 肩
            p.ellipse(elbowX, elbowY, 12, 12); // 肘
            p.ellipse(wristX, wristY, 10, 10); // 手首

            // ダーツを描画
            if (prediction.elbow_angle < 90) { // ダーツを投げる動作と判断
                p.fill(0, 100, 0);
                p.ellipse(handX, handY, 10, 10);

                // ダーツの飛んでいく軌道を点線で表示
                p.stroke(0, 100, 0, 150);
                p.strokeWeight(1);
                p.drawingContext.setLineDash([5, 5]);
                const targetX = 500;
                const targetY = 200;
                p.line(handX, handY, targetX, targetY);
                p.drawingContext.setLineDash([]);

                // ダーツのターゲットを描画
                p.noStroke();
                p.fill(100, 0, 0);
                p.ellipse(targetX, targetY, 40, 40);
                p.fill(255);
                p.ellipse(targetX, targetY, 25, 25);
                p.fill(100, 0, 0);
                p.ellipse(targetX, targetY, 10, 10);
            }
        };

        p.updateWithData = function() {
            if (predictions.length > 0) {
                p.redraw();
            }
        };

    }, 'animationContainer');
}

        function visualizeData() {
            if (!processedTestData || processedTestData.length === 0 || !predictions || predictions.length === 0) {
                console.warn("No data to visualize.");
                return;
            }
            // 筋変位データの可視化
            const muscleDataCtx = document.getElementById('muscleDataChart').getContext('2d');
            const muscleDataChart = new Chart(muscleDataCtx, {
                type: 'line',
                data: {
                    labels: processedTestData.map((_, index) => index + 1), // フレーム番号
                    datasets: muscleChannels.map(ch => ({
                        label: ch,
                        data: processedTestData.map(row => row[ch]),
                        borderColor: getRandomColor(),
                        fill: false,
                        borderWidth: 1,
                        pointRadius: 0
                    }))
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Frame'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Muscle Displacement'
                            }
                        }
                    }
                }
            });

           // 角度データの可視化
            const angleDataCtx = document.getElementById('angleDataChart').getContext('2d');
            const angleDataChart = new Chart(angleDataCtx, {
                type: 'line',
                data: {
                    labels: predictions.map((_, index) => index + 1),
                    datasets: angleColumns.map(col => ({
                        label: col,
                        data: predictions.map(p => p[col]),
                        borderColor: getRandomColor(),
                        fill: false,
                         borderWidth: 2,
                        pointRadius: 1
                    }))
                 },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                     scales: {
                        x: {
                             title: {
                                 display: true,
                                text: 'Frame'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Angle (degrees)'
                            }
                        }
                    }
                 }
             });
        }

        // ランダムな色を生成する関数
        function getRandomColor() {
            const letters = '0123456789ABCDEF';
            let color = '#';
            for (let i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }
            return color;
        }


        // アニメーションの再生
        function playAnimation() {
            if (isPlaying) return;

            isPlaying = true;
            playAnimationButton.disabled = true;
            pauseAnimationButton.disabled = false;

            function animate() {
                if (!isPlaying) return;

                if (currentFrame < predictions.length - 1) {
                    currentFrame++;
                    animationFrameId = setTimeout(animate, animationSpeed);
                } else {
                    // 最後のフレームで停止
                    isPlaying = false;
                    playAnimationButton.disabled = false;
                    pauseAnimationButton.disabled = true;
                }
                // p5.jsの描画関数を更新
                if (window.p5 && window.p5.prototype.updateWithData) {
                  window.p5.prototype.updateWithData();
                }
            }

            animate();
        }

        // アニメーションの一時停止
        function pauseAnimation() {
            isPlaying = false;
            playAnimationButton.disabled = false;
            pauseAnimationButton.disabled = true;
            clearTimeout(animationFrameId);
        }

        // アニメーションのリセット
        function resetAnimation() {
            isPlaying = false;
            currentFrame = 0;
            playAnimationButton.disabled = false;
            pauseAnimationButton.disabled = true;
            clearTimeout(animationFrameId);

            // p5.jsの描画関数を更新
             if (window.p5 && window.p5.prototype.updateWithData) {
                window.p5.prototype.updateWithData();
             }
            angleInfoDiv.innerHTML = ''; // 角度情報をクリア
        }
        // データ可視化の呼び出し (予測後)
        processTestButton.addEventListener('click', () => {
          // ... (他の処理)
          // 予測が完了した後に可視化関数を呼び出す
            const checkPredictionsInterval = setInterval(() => {
              if (predictions.length > 0 && predictions.length === processedTestData.length){
                visualizeData();
                clearInterval(checkPredictionsInterval);
              }
            }, 500); //500ミリ秒ごとに予測が完了しているか確認

        });