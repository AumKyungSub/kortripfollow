import React from 'react'
import { useNavigate } from 'react-router-dom';    

const SeasonsComponent = (props) => {
  const navigate = useNavigate();

  const goToNext = () => {
    navigate(props.function);
  };

  return (
    <div className="card" onClick={goToNext}>
      <div className="catImgCover">
        <img src={`/images/icon/${props.imgName}`} alt={props.imgName} />
      </div>
      <p>{props.name}</p>
    </div>
  )
}

export default SeasonsComponent
