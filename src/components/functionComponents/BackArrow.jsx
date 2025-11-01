import React from 'react'
import { useNavigate } from 'react-router-dom'

// Page css
import './BackArrow.style.css'

const BackArrow = () => {
  const navigate = useNavigate();
  
  const backToMain=()=>{
    navigate('/');
  }

  return (
    <div className='backArrowCover' onClick={backToMain}>
        <img src="/images/icon/backIcon.png" alt="backIcon" />
    </div>
  )
}

export default BackArrow
