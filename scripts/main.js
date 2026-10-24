/*
  Declaration of global variables
*/

//Product info variables
let productName;
let productPrice;
let productImage;

//Timeout IDs
let shakeTimeout;
let toastTimeout;
let warningTimeout;
let guessAnimationTimeouts = [];

/*
  Global variable constants
*/

//The day Costcodle was launched. Used to find game number each day
const costcodleStartDate = new Date("09/21/2023");
const gameNumber = getGameNumber();

//Elements with event listeners to play the game
let input = document.getElementById("guess-input");
let buttonInput = document.getElementById("guess-button");

const infoButton = document.getElementById("info-button");
infoButton.addEventListener("click", switchState);

const statButton = document.getElementById("stat-button");
statButton.addEventListener("click", switchState);

//User stats object
const userStats = JSON.parse(localStorage.getItem("stats")) || {
  numGames: 0,
  numWins: 0,
  winsInNum: [0, 0, 0, 0, 0, 0],
  currentStreak: 0,
  maxStreak: 0,
};

//User game state
let gameState = JSON.parse(localStorage.getItem("state")) || {
  gameNumber: -1,
  guesses: [],
  hasWon: false,
};
let isExtraGame = false;

/*
  Starts playing the game. Called at beginning of execution
*/

playGame();

function playGame() {
  const savedExtraGame = JSON.parse(localStorage.getItem("extraState"));

  if (savedExtraGame?.dailyGameNumber === gameNumber) {
    isExtraGame = true;
    gameState = savedExtraGame;
    fetchGameData(savedExtraGame.gameNumber);
    return;
  }

  localStorage.removeItem("extraState");
  fetchGameData(gameNumber);
}

/*
  Acquiring Game Data
*/

//Fetches the current day's game data from the json and starts game
function fetchGameData(productGameNumber) {
  fetch("./games.json?v=2")
    .then((response) => response.json())
    .then((json) => {
      const product = json[`game-${productGameNumber}`];
      productName = product.name;
      productPrice = product.price;
      productPrice = Number(productPrice.slice(1, productPrice.length));
      productImage = product.image;

      initializeGame();
    });
}

/*
  Used to initialize the game board using the current game state
*/

function initializeGame() {
  if (isExtraGame) {
    displayProductCard();
    updateGameBoard();

    if (gameState.guesses.length < 6 && !gameState.hasWon) {
      addEventListeners();
    } else {
      convertToShareButton();
    }
    return;
  }

  //Reset game state and track new game if user last played on a previous day
  if (gameState.gameNumber !== gameNumber) {
    if (gameState.hasWon === false) {
      userStats.currentStreak = 0;
    }
    gameState.gameNumber = gameNumber;
    gameState.guesses = [];
    gameState.hasWon = false;
    userStats.numGames++;

    saveGameState();
    localStorage.setItem("stats", JSON.stringify(userStats));
  }

  displayProductCard();

  updateGameBoard();

  if (gameState.guesses.length < 6 && !gameState.hasWon) {
    addEventListeners();
  } else {
    convertToShareButton();
  }
}

function convertToShareButton() {
  const containerElem = document.getElementById("input-container");
  const shareButtonElem = document.createElement("button");
  const moreButtonElem = document.createElement("button");
  const actionsElem = document.createElement("div");

  actionsElem.setAttribute("id", "end-game-actions");
  shareButtonElem.setAttribute("id", "share-button");
  shareButtonElem.innerHTML = `Сподели
  <img src="./assets/share-icon.svg" class="share-icon" />`;
  shareButtonElem.addEventListener("click", copyStats);

  moreButtonElem.setAttribute("id", "more-button");
  moreButtonElem.innerHTML = "Още";
  moreButtonElem.addEventListener("click", startExtraGame);

  actionsElem.appendChild(shareButtonElem);
  actionsElem.appendChild(moreButtonElem);
  containerElem.innerHTML = "";
  containerElem.appendChild(actionsElem);
}

function displayProductCard() {
  //First, update the image container with the new product image
  const imageContainer = document.getElementById("image-container");
  imageContainer.innerHTML = "";

  //Create a new image element to dynamically store game image
  const productImageElement = document.createElement("img");
  productImageElement.src = productImage;
  productImageElement.setAttribute("id", "product-image");

  //Add created image to the image container
  imageContainer.appendChild(productImageElement);

  //Select product info element and update the html to display product name
  const productInfo = document.getElementById("product-info");
  productInfo.innerHTML = `<center>${productName}</center>`;
}

function updateGameBoard() {
  updateGuessStat();

  gameState.guesses.forEach((guess, index) => displayGuess(guess, index + 1));
}

function updateGuessStat() {
  const guessStats = document.getElementById("game-stats");
  const formattedProductPrice = productPrice.toFixed(2);
  if (gameState.hasWon) {
    guessStats.innerHTML = `<center>Печелиш! Поздравления!🎉</center>`;
    guessStats.innerHTML += `<center>Цената беше €${formattedProductPrice}</center>`;
    return;
  }

  if (gameState.guesses.length === 6) {
    guessStats.innerHTML = `<center>Следващия път ще имаш повече късмет!</center>`;
    guessStats.innerHTML += `<center>Цената беше €${formattedProductPrice}</center>`;
  } else {
    guessStats.innerHTML = `Опит: ${gameState.guesses.length + 1}/6`;
  }
}

/*
  Event Listeners
*/

//Text input event listener to submit guess when user presses "Enter"
function inputEventListener(event) {
  if (event.key === "Enter") {
    handleInput();
  }
}

//Button event listener to submit guess when user presses guess button
function buttonEventListener() {
  handleInput();
}

function handleInput() {
  const strippedString = input.value.replaceAll(",", "");
  const guess = Number(strippedString).toFixed(2);

  if (isNaN(guess) || !strippedString) {
    displayWarning();
    return;
  }

  checkGuess(guess);

  input.value = "";

  function displayWarning() {
    clearTimeout(warningTimeout);

    const warningElem = document.getElementById("warning-toast");
    warningElem.classList.remove("hide");
    warningElem.classList.add("animate__flipInX");

    warningTimeout = setTimeout(() => {
      warningElem.classList.remove("animate__flipInX");
      warningElem.classList.add("animate__flipOutX");
      setTimeout(() => {
        warningElem.classList.remove("animate__flipOutX");
        warningElem.classList.add("hide");
      }, 1000);
    }, 2000);
  }
}

function copyStats() {
  let output = isExtraGame ? "BILDLE Още" : `BILDLE #${gameNumber}`;
  if (!gameState.hasWon) {
    output += ` X/6\n`;
  } else {
    output += ` ${gameState.guesses.length}/6\n`;
  }

  gameState.guesses.forEach((guess) => {
    switch (guess.direction) {
      case "&uarr;":
        output += `⬆️`;
        break;
      case "&darr;":
        output += `⬇️`;
        break;
      case "&check;":
        output += `✅`;
        break;
    }

    switch (guess.closeness) {
      case "guess-far":
        output += `🟥`;
        break;
      case "guess-near":
        output += `🟨`;
        break;
    }
    output += `\n`;
  });

  const isMobile =
    navigator.userAgent.match(/Android/i) ||
    navigator.userAgent.match(/webOS/i) ||
    navigator.userAgent.match(/iPhone/i) ||
    navigator.userAgent.match(/iPad/i) ||
    navigator.userAgent.match(/iPod/i) ||
    navigator.userAgent.match(/BlackBerry/i) ||
    navigator.userAgent.match(/Windows Phone/i) ||
    navigator.userAgent.match(/IEMobile/i) ||
    navigator.userAgent.match(/Opera Mini/i);

  if (isMobile) {
    if (navigator.canShare) {
      navigator
        .share({
          title: "BILDLE",
          text: output,
          url: "https://billa.afakeman.com",
        })
        .catch((error) => console.error("Share failed:", error));
    }
  } else {
    output += `https://billa.afakeman.com`;
    navigator.clipboard.writeText(output);
    displayToast();
  }

  function displayToast() {
    clearTimeout(toastTimeout);

    const toastElem = document.getElementById("share-toast");
    toastElem.classList.remove("hide");
    toastElem.classList.add("animate__flipInX");

    toastTimeout = setTimeout(() => {
      toastElem.classList.remove("animate__flipInX");
      toastElem.classList.add("animate__flipOutX");
      setTimeout(() => {
        toastElem.classList.remove("animate__flipOutX");
        toastElem.classList.add("hide");
      }, 1000);
    }, 3000);
  }
}

function addEventListeners() {
  input.addEventListener("keydown", inputEventListener);
  buttonInput.addEventListener("click", buttonEventListener);

  input.addEventListener("focus", () => {
    input.setAttribute("placeholder", "0.00");
  });
  input.addEventListener("blur", () => {
    input.setAttribute("placeholder", "Въведи цена...");
  });
}

function removeEventListeners() {
  buttonInput.setAttribute("disabled", "");
  buttonInput.classList.remove("active");
  input.setAttribute("disabled", "");
  input.setAttribute("placeholder", "Играта приключи!");
  input.removeEventListener("keydown", inputEventListener);
  buttonInput.removeEventListener("click", buttonEventListener);
}

function saveGameState() {
  localStorage.setItem(isExtraGame ? "extraState" : "state", JSON.stringify(gameState));
}

function renderGuessInput() {
  const containerElem = document.getElementById("input-container");

  containerElem.className = "guess-container transparent-background";
  containerElem.innerHTML = `
    <div id="text-input-container">
      <div id="input-label">€</div>
      <input
        id="guess-input"
        type="text"
        pattern="^\\d{1,3}(,\\d{3})*(\\.\\d+)?$"
        data-type="currency"
        placeholder="Въведи цена..."
      />
    </div>
    <div id="button-container">
      <button id="guess-button" class="active">Провери</button>
    </div>`;

  input = document.getElementById("guess-input");
  buttonInput = document.getElementById("guess-button");
}

async function startExtraGame() {
  const response = await fetch("./games.json?v=2");
  const json = await response.json();
  const previousGameNumbers = Object.keys(json)
    .map((key) => Number(key.replace("game-", "")))
    .filter((number) => number < gameNumber && number !== gameState.gameNumber);

  if (previousGameNumbers.length === 0) {
    return;
  }

  const selectedGameNumber =
    previousGameNumbers[Math.floor(Math.random() * previousGameNumbers.length)];

  isExtraGame = true;
  gameState = {
    dailyGameNumber: gameNumber,
    gameNumber: selectedGameNumber,
    guesses: [],
    hasWon: false,
  };
  saveGameState();

  resetBoardForNewGame();
  const product = json[`game-${selectedGameNumber}`];
  productName = product.name;
  productPrice = Number(product.price.slice(1));
  productImage = product.image;
  initializeGame();
}

function resetBoardForNewGame() {
  guessAnimationTimeouts.forEach((timeout) => clearTimeout(timeout));
  guessAnimationTimeouts = [];
  document.getElementById("image-container").innerHTML = "";

  for (let index = 1; index <= 6; index++) {
    const guessContainer = document.getElementById(index);
    guessContainer.className = "guess-container";
    guessContainer.innerHTML = "";
  }

  renderGuessInput();
}

/*
  Handles the logic of Costocodle
  Creates a guess object based on user guess and checks win condition
*/

function checkGuess(guess) {
  const guessObj = { guess, closeness: "", direction: "" };

  const percentAway = calculatePercent(guess);
  const absoluteDifference = Math.abs(Number(guess) - productPrice);
  const winningDifference = Math.max(productPrice * 0.05, 0.5);

  if (absoluteDifference <= winningDifference) {
    guessObj.closeness = "guess-win";
    gameState.hasWon = true;
  } else {
    shakeBox();
    if (Math.abs(percentAway) <= 25) {
      guessObj.closeness = "guess-near";
    } else {
      guessObj.closeness = "guess-far";
    }
  }

  if (gameState.hasWon) {
    guessObj.direction = "&check;";
  } else if (percentAway < 0) {
    guessObj.direction = "&uarr;";
  } else {
    guessObj.direction = "&darr;";
  }

  gameState.guesses.push(guessObj);
  saveGameState();

  displayGuess(guessObj);

  if (gameState.hasWon) {
    gameWon();
  } else if (gameState.guesses.length === 6) {
    gameLost();
  }
}

/*
  Displays guess object from either game state or a new guess
*/

function displayGuess(guess, index = gameState.guesses.length) {
  const guessContainer = document.getElementById(index);
  const guessValueContainer = document.createElement("div");
  const infoContainer = document.createElement("div");

  guessValueContainer.classList.add(
    "guess-value-container",
    "animate__flipInX"
  );

  infoContainer.classList.add("guess-direction-container", "animate__flipInX");

  guessValueContainer.innerHTML = `€${guess.guess}`;

  infoContainer.classList.add(guess.closeness);
  const directionSymbol = document.createElement("span");
  directionSymbol.className = "guess-direction-symbol";
  directionSymbol.innerHTML = guess.direction;
  infoContainer.appendChild(directionSymbol);

  guessContainer.classList.add("animate__flipOutX");

  const animationTimeout = setTimeout(() => {
    guessContainer.classList.add("transparent-background");
    guessContainer.appendChild(guessValueContainer);
    guessContainer.appendChild(infoContainer);
  }, 500);
  guessAnimationTimeouts.push(animationTimeout);

  updateGuessStat();
}

/*
  Helper function to compute guess accuracy
*/

function calculatePercent(guess) {
  return ((guess * 100) / (productPrice * 100)) * 100 - 100;
}

/* 
  End state function to handle win/loss conditions
*/

function gameWon() {
  if (!isExtraGame) {
    userStats.numWins++;
    userStats.currentStreak++;
    userStats.winsInNum[gameState.guesses.length - 1]++;
    if (userStats.currentStreak > userStats.maxStreak) {
      userStats.maxStreak = userStats.currentStreak;
    }
  }
  gameState.hasWon = true;

  saveGameState();
  if (!isExtraGame) {
    localStorage.setItem("stats", JSON.stringify(userStats));
  }
  removeEventListeners();
  convertToShareButton();
}

function gameLost() {
  if (!isExtraGame) {
    userStats.currentStreak = 0;
    localStorage.setItem("stats", JSON.stringify(userStats));
  }

  saveGameState();

  removeEventListeners();
  convertToShareButton();
}

/*
  DOM manipulation functions for overlays and animations
*/

function switchState(event) {
  const overlayBtnClicked = event.currentTarget.dataset.overlay;
  const overlayElem = document.getElementById(overlayBtnClicked);
  const title = document.getElementById("title");

  if (title.classList.contains("info-title")) {
    title.classList.remove("info-title");
  }

  if (overlayElem.style.display === "flex") {
    title.innerHTML = `<span class="bildle-yellow">BIL</span><span class="bildle-red">DLE</span>`;
    overlayElem.style.display = "none";
    return;
  }

  if (overlayBtnClicked === "info-overlay") {
    document.getElementById("stats-overlay").style.display = "none";
    renderInfo();
  } else {
    document.getElementById("info-overlay").style.display = "none";
    renderStats();
  }

  function renderInfo() {
    title.innerHTML = `КАК СЕ <span class="bildle-red">ИГРАЕ</span>`;
    if (!title.classList.contains("info-title")) {
      title.classList.add("info-title");
    }
    overlayElem.style.display = "flex";
  }

  function renderStats() {
    title.innerHTML = `<span class="bildle-red">СТАТИСТИКА</span>`;

    if (!title.classList.contains("info-title")) {
      title.classList.add("info-title");
    }

    renderStatistics();
    graphDistribution();

    overlayElem.style.display = "flex";

    function renderStatistics() {
      const numWinsElem = document.getElementById("number-wins");
      numWinsElem.innerHTML = `${userStats.numGames}`;

      const winPercentElem = document.getElementById("win-percent");
      if (userStats.numGames === 0) {
        winPercentElem.innerHTML = `0`;
      } else {
        winPercentElem.innerHTML = `${Math.round(
          (userStats.numWins / userStats.numGames) * 100
        )}`;
      }

      const currentStreakElem = document.getElementById("current-streak");
      currentStreakElem.innerHTML = `${userStats.currentStreak}`;

      const maxStreakElem = document.getElementById("max-streak");
      maxStreakElem.innerHTML = `${userStats.maxStreak}`;
    }

    function graphDistribution() {
      console.log("here");
      userStats.winsInNum.forEach((value, index) => {
        const graphElem = document.getElementById(`graph-${index + 1}`);
        if (userStats.numWins === 0) {
          graphElem.style = `width: 5%`;
        } else {
          graphElem.style = `width: ${
            Math.floor((value / userStats.numWins) * 0.95 * 100) + 5
          }%`;
        }
        graphElem.innerHTML = `${value}`;
      });
    }
  }
}

function shakeBox() {
  clearTimeout(shakeTimeout);
  const infoCard = document.getElementById("info-card");
  if (infoCard.classList.contains("animate__headShake")) {
    infoCard.classList.remove("animate__headShake");
  }
  shakeTimeout = setTimeout(
    () => infoCard.classList.add("animate__headShake"),
    100
  );
}

/*
  Finds current game number based off of Costcodle start date
*/

function getGameNumber() {
  const currDate = new Date();
  let timeDifference = currDate.getTime() - costcodleStartDate.getTime();
  let dayDifference = timeDifference / (1000 * 3600 * 24);

  return Math.ceil(dayDifference) + 1;
}

